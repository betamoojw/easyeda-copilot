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
import {
    diffRoutingRules,
    mergeEasyEdaDrcIntoRoutingRules,
    routingRulesToEasyEdaDrcBundle,
    routingZonesToEasyEdaDrcBundle,
} from './easyeda-drc-adapter';

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

    const sourceRules = mergeEasyEdaDrcIntoRoutingRules(nativeDrc, imported.board.rules);
    const routerInput = {
        board: { ...imported.board, rules: sourceRules },
        dsl: program,
    };
    await writeFile(
        join(artifactsDirectory, 'copilot-router-input.json'),
        `${JSON.stringify(routerInput, null, 2)}\n`,
    );

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
        ...routerInput,
        backend,
        signal,
    });
    await writeFile(
        join(artifactsDirectory, 'routing-result.json'),
        `${JSON.stringify(result, null, 2)}\n`,
    );
    signal.throwIfAborted();
    const routingErrors = result.diagnostics.filter(item => item.severity === 'error');
    if (result.status === 'error') {
        throw new Error(diagnosticsMessage(routingErrors) || 'PCB router DSL failed.');
    }

    context.setStage('preparing_application');
    const translatedApplication = routingResultToEasyEdaApplication(result);
    const unsupported = adapterErrors(result, translatedApplication.diagnostics);
    if (unsupported.length) throw new Error(diagnosticsMessage(unsupported));
    // Import warnings describe native source objects that were deliberately
    // skipped. Preserve them in the operation result and its artifact instead
    // of losing them when the router returns successfully.
    const application = {
        ...translatedApplication,
        diagnostics: [...imported.diagnostics, ...translatedApplication.diagnostics],
    };
    await writeFile(
        join(artifactsDirectory, 'easyeda-routing-application.json'),
        `${JSON.stringify(application, null, 2)}\n`,
    );
    const shouldApplyDrc = result.operation === 'apply-drc' || result.operation === 'all';
    const ruleChanges = diffRoutingRules(sourceRules, result.rules);
    let bundle = shouldApplyDrc && ruleChanges.hasChanges
        ? routingRulesToEasyEdaDrcBundle(nativeDrc, sourceRules, result.rules)
        : undefined;
    const zonesWithDrc = application.zones.filter(zone => (
        zone.clearanceMm !== undefined || zone.connection !== undefined || zone.padConnection !== undefined
    ));
    if (zonesWithDrc.length) {
        bundle = routingZonesToEasyEdaDrcBundle(bundle ?? nativeDrc, zonesWithDrc);
    }
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
