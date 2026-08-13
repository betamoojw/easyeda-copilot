import { run, type RoutingPolicy, type RoutingResult } from '@easyeda-copilot/router';
import {
    createEasyEdaWasmBackend,
    type EasyEdaWasmEngine,
} from '@easyeda-copilot/router/backends/easyeda-wasm';
import type { Bridge } from '../bridge';
import { runEasyEdaAutoRouter } from '../autorouter/autorouter';
import {
    importEasyEdaAutorouteJson,
    routingResultToEasyEdaApplication,
    type EasyEdaRoutingApplication,
} from './easyeda-autoroute-adapter';
import { routingRulesToEasyEdaDrcBundle } from './easyeda-drc-adapter';

type JsonRecord = Record<string, unknown>;

export type RunEasyEdaRoutingRequest = Readonly<{
    dsl: string;
    timeoutMs?: number;
    policy?: RoutingPolicy;
    signal?: AbortSignal;
    existingCopper?: 'fixed' | 'editable';
    apply?: boolean;
    onProgress?: (progress: number) => void;
}>;

export type RunEasyEdaRoutingResponse = Readonly<{
    result: RoutingResult;
    application: EasyEdaRoutingApplication;
    applied: boolean;
    importResult?: unknown;
    drcResult?: unknown;
}>;

function record(value: unknown): JsonRecord | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
}

/**
 * The only live EasyEDA boundary: capture once, route completely offline, and
 * apply once. The router package itself never calls EasyEDA APIs.
 */
export async function runRoutingOnCurrentEasyEdaPcb(
    bridge: Bridge,
    request: RunEasyEdaRoutingRequest,
): Promise<RunEasyEdaRoutingResponse> {
    if (request.apply !== false && request.existingCopper === 'fixed') {
        throw new TypeError('Live EasyEDA apply requires existingCopper="editable" because RoutingResult replaces router-owned copper.');
    }
    const capture = record(await bridge.requestEasyEda('export-routing-input', {}, 300_000));
    const source = typeof capture?.text === 'string' ? capture.text : '';
    if (!capture || !source) throw new TypeError('EasyEDA returned empty autoroute JSON');
    const sourceJson = JSON.parse(source) as unknown;
    const imported = importEasyEdaAutorouteJson(sourceJson, {
        existingCopper: request.existingCopper ?? 'editable',
    });
    if (!imported.board) throw new TypeError(`EasyEDA routing import failed: ${JSON.stringify(imported.diagnostics)}`);

    const timeoutMs = request.timeoutMs ?? request.policy?.timeoutMs ?? 600_000;
    const engine: EasyEdaWasmEngine = async (input, options) => {
        const output = await runEasyEdaAutoRouter(input, {
            timeoutMs,
            signal: options.signal,
            onProgress: request.onProgress,
        });
        return output as Awaited<ReturnType<EasyEdaWasmEngine>>;
    };
    const backend = createEasyEdaWasmBackend({ engine });
    const result = await run({
        board: imported.board,
        dsl: request.dsl,
        backend,
        ...(request.policy ? { policy: request.policy } : {}),
        ...(request.signal ? { signal: request.signal } : {}),
    });
    const application = routingResultToEasyEdaApplication(result);
    if (request.apply === false || result.status === 'error') {
        return { result, application, applied: false };
    }

    const nativeDrc = record(capture.drc);
    const bundle = result.rules.applyRequested
        ? routingRulesToEasyEdaDrcBundle(nativeDrc as never, result.rules.effective)
        : undefined;
    const applied = await bridge.requestEasyEda('apply-routing-result', {
        ...(bundle ? { bundle } : {}),
        ...(result.copper ? { copper: result.copper } : {}),
    }, 300_000);
    const appliedRecord = record(applied);
    return {
        result,
        application,
        applied: true,
        importResult: appliedRecord?.copper,
        drcResult: appliedRecord?.rules,
    };
}
