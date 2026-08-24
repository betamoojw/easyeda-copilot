import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
    compileRoutingDsl,
    run,
    type RoutingDiagnostic,
    type RoutingResult,
} from 'eda-copilot-router';
import { createKrtBackend } from 'eda-copilot-router/backends/krt';
import { PcbDrcBundleSchema, type PcbDrcBundle } from '@copilot/shared/types/pcb/drc.js';
import type { Bridge } from '../bridge';
import { operationManager, type OperationContext } from '../operations/manager';
import { TEMP_DIR } from '../utils/dirs';
import {
    importEasyEdaAutorouteJson,
    routingResultToEasyEdaApplication,
} from './easyeda-autoroute-adapter';
import { routingRulesToEasyEdaDrcBundle } from './easyeda-drc-adapter';

const PCB_DOCUMENT_RESOURCE = 'current-pcb-document';
const ROUTER_TIMEOUT_MS = 60 * 60 * 1000;

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as JsonRecord
        : undefined;
}

function diagnosticsMessage(diagnostics: readonly RoutingDiagnostic[]) {
    return diagnostics
        .filter(item => item.severity === 'error')
        .map(item => `${item.code}: ${item.message}`)
        .join('\n');
}

function adapterErrors(result: RoutingResult, diagnostics: readonly RoutingDiagnostic[]) {
    return diagnostics.slice(result.diagnostics.length).filter(item => item.severity === 'error');
}

async function executeRoutingOperation(
    bridge: Bridge,
    dslFile: string,
    context: OperationContext,
) {
    const artifactsDirectory = join(TEMP_DIR, 'copilot-router', context.id.replace(':', '-'));
    await mkdir(artifactsDirectory, { recursive: true });

    context.setStage('reading_dsl');
    const dslPath = resolve(dslFile);
    const dsl = await readFile(dslPath, 'utf8');
    const program = compileRoutingDsl(dsl);
    await writeFile(join(artifactsDirectory, 'routing.dsl.js'), dsl);
    context.signal.throwIfAborted();

    context.setStage('exporting');
    const capture = record(await bridge.requestEasyEda('export-routing-input', {}, 300_000));
    const source = typeof capture?.text === 'string' ? capture.text : '';
    if (!capture || !source) throw new Error('EasyEDA returned empty autoroute JSON.');
    await writeFile(join(artifactsDirectory, 'easyeda-routing-input.json'), source);
    const nativeDrc = PcbDrcBundleSchema().parse(capture.drc) as PcbDrcBundle;
    await writeFile(
        join(artifactsDirectory, 'easyeda-drc-input.json'),
        `${JSON.stringify(nativeDrc, null, 2)}\n`,
    );
    context.signal.throwIfAborted();

    context.setStage('importing');
    const imported = importEasyEdaAutorouteJson(JSON.parse(source) as unknown, {
        ...(program.clearRouting ? { clearRouting: program.clearRouting } : {}),
    });
    if (!imported.board) {
        throw new Error(`EasyEDA routing import failed:\n${diagnosticsMessage(imported.diagnostics)}`);
    }

    context.setStage('routing');
    const backend = createKrtBackend({
        artifactsDirectory: join(artifactsDirectory, 'krt'),
        keepArtifacts: true,
    });
    const signal = AbortSignal.any([
        context.signal,
        AbortSignal.timeout(ROUTER_TIMEOUT_MS),
    ]);
    const result = await run({
        board: imported.board,
        dsl: program,
        backend,
        policy: { profile: 'completion-first' },
        signal,
    });
    await writeFile(
        join(artifactsDirectory, 'routing-result.json'),
        `${JSON.stringify(result, null, 2)}\n`,
    );
    signal.throwIfAborted();
    const routingErrors = result.diagnostics.filter(item => item.severity === 'error');
    if (result.status === 'error' || routingErrors.length) {
        throw new Error(diagnosticsMessage(routingErrors) || 'PCB router DSL failed.');
    }

    context.setStage('preparing_application');
    const application = routingResultToEasyEdaApplication(result);
    const unsupported = adapterErrors(result, application.diagnostics);
    if (unsupported.length) throw new Error(diagnosticsMessage(unsupported));
    const bundle = result.rules.applyRequested
        ? routingRulesToEasyEdaDrcBundle(nativeDrc, result.rules.effective)
        : undefined;
    signal.throwIfAborted();

    context.setStage('applying');
    const applied = record(await bridge.requestEasyEda('apply-routing-result', {
        application,
        ...(bundle ? { bundle } : {}),
    }, 300_000));
    if (!applied || applied.applied !== true) {
        throw new Error('EasyEDA did not confirm the routing transaction.');
    }

    return {
        status: result.status,
        operation: result.operation,
        operation_id: context.id,
        tracks: application.tracks.length,
        vias: application.vias.length,
        zones: application.zones.length,
        native_verification: applied?.nativeVerification ?? 'not-run',
        diagnostics: application.diagnostics,
        metrics: result.metrics,
        artifacts_directory: artifactsDirectory,
        apply_result: applied,
    };
}

export async function runPcbRouterDsl(
    bridge: Bridge,
    dslFile: string,
    waitMs = 30_000,
) {
    const operationId = operationManager.start(
        'pcb-dsl',
        context => executeRoutingOperation(bridge, dslFile, context),
        { resource: PCB_DOCUMENT_RESOURCE },
    );
    return operationManager.wait(operationId, waitMs);
}
