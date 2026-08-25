import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const adapter = await import(pathToFileURL(resolve('dist/routing/easyeda-autoroute-adapter.js')).href);
const drcAdapter = await import(pathToFileURL(resolve('dist/routing/easyeda-drc-adapter.js')).href);
const router = await import('eda-copilot-router');

const fixture = {
    boardOutline: { path: [[-5, -5], [5, -5], [5, 5], [-5, 5], [-5, -5]] },
    layers: { route: [1, 2], notRoute: [] },
    rules: {
        safeClearances: { cls: [{ layers: [1, 2], trackToTrack: 0.2, trackToBoardOutline: 0.5 }] },
        trackWidths: { cls: [{ layers: [1, 2], trackWidth: [0.2, 0.25, 0.3] }] },
        viaSizes: { via_cls: [0.6, 0.3] },
        differentialPairs: {},
    },
    classes: { differentialPairClasses: { pair: ['SIG', 'SIG_N'] } },
    nets: [
        { net: 'SIG', safeClearance: 'cls', trackWidth: 'cls', viaSize: 'via_cls' },
        { net: 'SIG_N', safeClearance: 'cls', trackWidth: 'cls', viaSize: 'via_cls' },
    ],
    components: {
        U1: {
            name: 'SHARED-MPN', footprint: 'fp', layer: 1, location: [1, 2], rotation: 90,
            nets: { p0: 'SIG', p1: 'SIG' }, pinName: { p0: 'VIN', p1: 'VIN' },
        },
        J1: {
            name: 'SHARED-MPN', footprint: 'tht', layer: 1, location: [-2, 0], rotation: 0,
            nets: { p0: 'SIG_N' }, pinName: { p0: '1' },
        },
    },
    footprints: {
        fp: {
            pads: {
                p0: { number: '1', layers: [1], location: [1, 0], path: [[0.5, -0.5], [1.5, -0.5], [1.5, 0.5], [0.5, 0.5]] },
                p1: { number: '1', layers: [1], location: [-1, 0], path: [[-1.5, -0.5], [-0.5, -0.5], [-0.5, 0.5], [-1.5, 0.5]] },
            },
        },
        tht: {
            pads: {
                p0: {
                    number: '1', layers: [1, 2], location: [0, 0], diameter: 2.5,
                    path: [[1.25, 0], [-1.25, 0, -180], [1.25, 0, -180]],
                },
            },
        },
    },
    tracks: [{ id: 'old', net: 'SIG', layer: 1, width: 0.2, path: [[1, 1], [2, 1]] }],
    vias: [], fillRegions: [], prohibitedRegions: [],
};

const imported = adapter.importEasyEdaAutorouteJson(fixture);
assert.ok(imported.board, JSON.stringify(imported.diagnostics));
assert.equal(imported.diagnostics.filter(item => item.severity === 'error').length, 0);
assert.deepEqual(imported.board.layers.map(item => item.name), ['F.Cu', 'B.Cu']);
assert.deepEqual(imported.board.components.map(item => item.designator), ['U1', 'J1']);
assert.equal(imported.board.pads.length, 3, 'duplicate logical pad numbers are physical pads, not an error');
assert.deepEqual(imported.board.pads.map(item => item.number), ['1', '1', '1']);
assert.deepEqual(imported.board.pads.map(item => item.at), [{ x: 1, y: -3 }, { x: 1, y: -1 }, { x: -2, y: 0 }]);
assert.deepEqual(imported.board.pads[0].shape, { kind: 'rect', widthMm: 1, heightMm: 1 });
assert.deepEqual(imported.board.pads[1].shape, { kind: 'rect', widthMm: 1, heightMm: 1 });
assert.deepEqual(imported.board.pads[2].shape, { kind: 'circle', diameterMm: 2.5 });
assert.equal(imported.board.copper.editable.tracks.length, 0);
assert.equal(imported.board.copper.fixed.tracks.length, 1);
assert.equal(imported.board.rules.nets[0].values.preferredTrackWidthMm, 0.25);
assert.deepEqual(imported.board.rules.differentialPairs, [{ id: 'pair', positive: 'SIG', negative: 'SIG_N' }]);

const differentialPresetFixture = structuredClone(fixture);
differentialPresetFixture.rules.differentialPairs = {
    diff: [{ width: [0.2], clearance: [0.25], lengthTolerance: 0.1 }],
};
for (const net of differentialPresetFixture.nets) net.differentialPair = 'diff';
differentialPresetFixture.nets.push({
    net: 'GND', safeClearance: 'cls', trackWidth: 'cls', viaSize: 'via_cls', differentialPair: 'diff',
});
const differentialPresetImport = adapter.importEasyEdaAutorouteJson(differentialPresetFixture);
assert.ok(differentialPresetImport.board, JSON.stringify(differentialPresetImport.diagnostics));
assert.ok(differentialPresetImport.board.rules.nets.find(rule => rule.net === 'SIG').values.differential);
assert.equal(
    differentialPresetImport.board.rules.nets.find(rule => rule.net === 'GND').values.differential,
    undefined,
    'a selected differential preset does not make an ordinary net a pair member',
);

const rerouteImport = adapter.importEasyEdaAutorouteJson(fixture, {
    clearRouting: { nets: ['SIG'], items: ['tracks'] },
});
assert.ok(rerouteImport.board, JSON.stringify(rerouteImport.diagnostics));
assert.equal(rerouteImport.board.copper.editable.tracks.length, 1);
assert.equal(rerouteImport.board.copper.fixed.tracks.length, 0);

const copperOnly = await router.run({
    board: rerouteImport.board,
    dsl: `clearRouting({ nets: ["SIG"], items: ["tracks"] }); runCopper();`,
});
assert.equal(copperOnly.status, 'complete');
assert.deepEqual(copperOnly.clearRouting, { nets: ['SIG'], items: ['tracks'] });
assert.equal(copperOnly.copper.tracks.length, 0);

const application = adapter.routingResultToEasyEdaApplication({
    status: 'complete', operation: 'route',
    rules: imported.board.rules,
    copper: {
        tracks: [{ net: 'SIG', layer: 'F.Cu', widthMm: 0.2, points: [{ x: 1, y: -3 }, { x: 2, y: -3 }] }],
        vias: [{ net: 'SIG', at: { x: 2, y: -3 }, diameterMm: 0.6, drillMm: 0.3, fromLayer: 'F.Cu', toLayer: 'B.Cu' }],
        zones: [],
    },
    diagnostics: [], metrics: { elapsedMs: 1 }, requiresNativeVerification: true,
});
assert.deepEqual(application.tracks[0].points, [[1, 3], [2, 3]]);
assert.deepEqual(application.vias[0].location, [2, 3]);
assert.equal(application.diagnostics.length, 0);

const stackupApplication = adapter.routingResultToEasyEdaApplication({
    status: 'complete', operation: 'apply-stackup',
    rules: imported.board.rules,
    stackup: {
        applyRequested: true,
        effective: {
            layers: [
                { kind: 'copper', layer: 'F.Cu', thicknessMm: 0.035 },
                { kind: 'dielectric', name: 'Core', thicknessMm: 1.5, relativePermittivity: 4.2 },
                { kind: 'copper', layer: 'B.Cu', thicknessMm: 0.035 },
            ],
        },
    },
    diagnostics: [], metrics: { elapsedMs: 1 }, requiresNativeVerification: true,
});
assert.equal(stackupApplication.copperLayerCount, 2);
assert.equal(stackupApplication.diagnostics[0].code, 'EASYEDA_STACKUP_LAYER_COUNT_ONLY');
assert.equal(stackupApplication.diagnostics[0].severity, 'warning');

const invalidStackupApplication = adapter.routingResultToEasyEdaApplication({
    status: 'complete', operation: 'apply-stackup',
    rules: imported.board.rules,
    stackup: {
        applyRequested: true,
        effective: {
            layers: [
                { kind: 'copper', layer: 'F.Cu', thicknessMm: 0.035 },
                { kind: 'dielectric', name: 'Core 1', thicknessMm: 0.7 },
                { kind: 'copper', layer: 'In1.Cu', thicknessMm: 0.035 },
                { kind: 'dielectric', name: 'Core 2', thicknessMm: 0.7 },
                { kind: 'copper', layer: 'B.Cu', thicknessMm: 0.035 },
            ],
        },
    },
    diagnostics: [], metrics: { elapsedMs: 1 }, requiresNativeVerification: true,
});
assert.equal(invalidStackupApplication.copperLayerCount, undefined);
assert.equal(invalidStackupApplication.diagnostics[0].code, 'EASYEDA_STACKUP_COPPER_LAYER_COUNT_UNSUPPORTED');
assert.equal(invalidStackupApplication.diagnostics[0].severity, 'error');

const values = {
    clearanceMm: 0.22, edgeClearanceMm: 0.5,
    minTrackWidthMm: 0.2, preferredTrackWidthMm: 0.3,
    via: { minDiameterMm: 0.6, preferredDiameterMm: 0.7, minDrillMm: 0.3, preferredDrillMm: 0.35 },
    differential: { trackWidthMm: 0.2, gapMm: 0.25, maxSkewMm: 0.1 },
};
const sourceValues = {
    ...values,
    clearanceMm: 0.2,
    preferredTrackWidthMm: 0.2,
    differential: undefined,
};
const sourceRoutingRules = {
    default: sourceValues,
    nets: ['SIG', 'SIG_N', 'MATCH_A', 'MATCH_B'].map(net => ({ net, values: sourceValues })),
};
const nativeDrcFixture = {
    ruleConfiguration: {
        Physics: {
            Track: { default: { editName: 'default', isSetDefault: true, form: { data: { '1': { minValue: 0.1, defaultValue: 0.2, maxValue: 1 } } } } },
            'Via Size': { default: { editName: 'default', isSetDefault: true, viaOuterdiameterMin: 0.5, viaOuterdiameterDefault: 0.6, viaOuterdiameterMax: 1, viaInnerdiameterMin: 0.2, viaInnerdiameterDefault: 0.3, viaInnerdiameterMax: 0.5 } },
            'Net Length Range': { default: { editName: 'default', netLengthMax: 100 } },
            'Net Length Tolerance': { default: { editName: 'default', isSetDefault: true, netLengthTolerance: 1 } },
            'Differential Pair': { default: { editName: 'default', isSetDefault: true, strokeWidthTables: { 1: [0.2] }, diffPairSpacingTables: { 1: [0.2] }, differentailPairLenTolerMax: 1 } },
        },
        Spacing: { 'Safe Spacing': { default: { editName: 'default', isSetDefault: true, tables: { 1: { content: [[0.2, 0.2]] } } } } },
    },
    netRules: [
        { type: 'net', name: 'SIG' },
        { type: 'net', name: 'SIG_N' },
        { type: 'net', name: 'MATCH_A' },
        { type: 'net', name: 'MATCH_B' },
    ],
};
const targetRoutingRules = {
    default: values,
    nets: [
        { net: 'SIG', values },
        { net: 'SIG_N', values },
        { net: 'MATCH_A', values },
        { net: 'MATCH_B', values },
    ],
    netClasses: [{ name: 'FAST', nets: ['SIG', 'SIG_N'], values }],
    differentialPairs: [{ id: 'pair', positive: 'SIG', negative: 'SIG_N' }],
    matchedGroups: [{ id: 'MATCHED', nets: ['MATCH_A', 'MATCH_B'], toleranceMm: 0.15 }],
};
const translated = drcAdapter.routingRulesToEasyEdaDrcBundle(
    nativeDrcFixture, sourceRoutingRules, targetRoutingRules,
);
assert.deepEqual(translated.netRules.map(rule => [rule.type, rule.name]), [
    ['netClass', 'FAST'],
    ['equalLengthGroup', 'MATCHED'],
    ['differentialPair', 'pair'],
]);
assert.equal('netClasses' in translated, false, 'relations belong to the native netRules tree');
assert.equal('differentialPairs' in translated, false, 'relations belong to the native netRules tree');
assert.equal('equalLengthGroups' in translated, false, 'relations belong to the native netRules tree');
assert.equal(JSON.stringify(translated).includes('"color"'), false, 'color is not routing/DRC data');

const fastClass = translated.netRules.find(rule => rule.type === 'netClass' && rule.name === 'FAST');
assert.deepEqual(fastClass.sub.map(rule => rule.name), ['SIG', 'SIG_N']);
assert.equal(fastClass.Track, 'copilot_router_class_0_track');
assert.equal(fastClass.sub[0].Track, fastClass.Track, 'class presets are repeated on native child nets');
assert.equal(fastClass.sub[0]['Differential Pair'], 'copilot_router_diff_0');

const pairRule = translated.netRules.find(rule => rule.type === 'differentialPair' && rule.name === 'pair');
assert.equal(pairRule.positiveNet, 'SIG');
assert.equal(pairRule.negativeNet, 'SIG_N');
assert.deepEqual(pairRule.sub, [{ type: 'net', name: 'SIG' }, { type: 'net', name: 'SIG_N' }]);

const matchedGroup = translated.netRules.find(rule => rule.type === 'equalLengthGroup' && rule.name === 'MATCHED');
assert.deepEqual(matchedGroup.sub.map(rule => rule.name), ['MATCH_A', 'MATCH_B']);
assert.equal(matchedGroup['Net Length Tolerance'], 'copilot_router_match_0');
assert.equal(matchedGroup.sub[0]['Net Length Tolerance'], 'copilot_router_match_0');
assert.equal(matchedGroup.sub[0].Track, 'copilot_router_net_2_track');
assert.equal(matchedGroup.sub[0]['Differential Pair'], undefined);

assert.equal(translated.ruleConfiguration.Physics.Track.copilot_router_class_0_track.form.data['1'].defaultValue, 0.3);
assert.equal(translated.ruleConfiguration.Physics.Track.copilot_router_class_0_track.isSetDefault, false);
assert.equal(translated.ruleConfiguration.Spacing['Safe Spacing'].copilot_router_class_0_spacing.tables['1'].content[0][0], 0.22);
assert.equal(
    translated.ruleConfiguration.Physics.Track.default.form.data['1'].defaultValue,
    0.3,
    'a changed global rule must update the native default Track preset',
);
assert.equal(
    translated.ruleConfiguration.Spacing['Safe Spacing'].default.tables['1'].content[0][0],
    0.22,
    'a changed global rule must update the native default Safe Spacing preset',
);

const deletedRelations = drcAdapter.routingRulesToEasyEdaDrcBundle(
    translated,
    targetRoutingRules,
    { default: values, nets: targetRoutingRules.nets },
);
assert.deepEqual(
    deletedRelations.netRules.filter(rule => rule.type !== 'net').map(rule => rule.type),
    [],
    'deleting all relation state must remove native class, differential-pair, and equal-length nodes',
);
assert.deepEqual(
    deletedRelations.netRules.filter(rule => rule.type === 'net').map(rule => rule.name).sort(),
    ['MATCH_A', 'MATCH_B', 'SIG', 'SIG_N'],
    'relation deletion must restore standalone native net roots',
);
assert.equal(
    deletedRelations.netRules.some(rule => rule.type === 'net' && rule['Differential Pair'] !== undefined),
    false,
    'deleting a differential pair must clear its native member assignments',
);

const noOpDrc = drcAdapter.routingRulesToEasyEdaDrcBundle(nativeDrcFixture, sourceRoutingRules, sourceRoutingRules);
assert.deepEqual(noOpDrc, nativeDrcFixture, 'a semantic no-op must preserve the native DRC bundle exactly');
assert.equal(drcAdapter.diffRoutingRules(sourceRoutingRules, sourceRoutingRules).hasChanges, false);

const existingClassBundle = structuredClone(nativeDrcFixture);
existingClassBundle.netRules = [{
    type: 'netClass', name: 'OLD', Track: 'default', 'Via Size': 'default', 'Safe Spacing': 'default',
    sub: [
        { type: 'net', name: 'SIG', Track: 'default', 'Via Size': 'default', 'Safe Spacing': 'default' },
        { type: 'net', name: 'SIG_N', Track: 'default', 'Via Size': 'default', 'Safe Spacing': 'default' },
    ],
}];
const importedRelationRules = drcAdapter.mergeEasyEdaDrcIntoRoutingRules(existingClassBundle, sourceRoutingRules);
assert.deepEqual(importedRelationRules.netClasses.map(item => [item.name, item.nets]), [
    ['OLD', ['SIG', 'SIG_N']],
]);
const movedRelationRules = {
    ...importedRelationRules,
    netClasses: [{ name: 'NEW', nets: ['SIG', 'SIG_N'], values: sourceValues }],
};
const movedRelationBundle = drcAdapter.routingRulesToEasyEdaDrcBundle(
    existingClassBundle, importedRelationRules, movedRelationRules,
);
assert.deepEqual(
    movedRelationBundle.netRules.filter(rule => rule.type === 'netClass').map(rule => [rule.type, rule.name]),
    [['netClass', 'NEW']],
);
assert.deepEqual(movedRelationBundle.netRules.find(rule => rule.type === 'netClass').sub.map(rule => rule.name), ['SIG', 'SIG_N']);
assert.equal(
    movedRelationBundle.netRules.flatMap(rule => rule.type === 'net' ? [rule] : rule.sub)
        .filter(rule => rule.name === 'SIG').length,
    1,
    'moving a net class must not duplicate the member in an old class',
);

const integratedSourceRules = drcAdapter.mergeEasyEdaDrcIntoRoutingRules(existingClassBundle, imported.board.rules);
assert.equal(
    integratedSourceRules.differentialPairs,
    undefined,
    'native DRC relations must override stale or inferred autoroute relations even when the native list is empty',
);
const integratedMove = await router.run({
    board: { ...imported.board, rules: integratedSourceRules },
    dsl: `netClass("NEW", { nets: ["SIG", "SIG_N"], trackWidthMm: 0.25 }); applyDrcRules();`,
});
assert.equal(integratedMove.status, 'complete');
assert.deepEqual(integratedMove.rules.netClasses.map(item => item.name), ['NEW']);
const integratedDiff = drcAdapter.diffRoutingRules(integratedSourceRules, integratedMove.rules);
assert.equal(integratedDiff.hasChanges, true);
assert.deepEqual([...integratedDiff.netClasses].sort(), ['NEW', 'OLD']);
const integratedBundle = drcAdapter.routingRulesToEasyEdaDrcBundle(
    existingClassBundle, integratedSourceRules, integratedMove.rules,
);
assert.deepEqual(integratedBundle.netRules.filter(rule => rule.type === 'netClass').map(rule => rule.name), ['NEW']);
assert.equal(
    integratedBundle.netRules.some(rule => rule.type === 'netClass' && rule.name === 'OLD'),
    false,
);

const integratedIncremental = await router.run({
    board: { ...imported.board, rules: integratedSourceRules },
    dsl: `signalNet("SIG", { trackWidthMm: 0.27 }); applyDrcRules();`,
});
assert.deepEqual(
    integratedIncremental.rules.netClasses,
    integratedSourceRules.netClasses,
    'an explicit per-net value change must preserve imported class membership',
);
const integratedIncrementalBundle = drcAdapter.routingRulesToEasyEdaDrcBundle(
    existingClassBundle, integratedSourceRules, integratedIncremental.rules,
);
assert.deepEqual(
    integratedIncrementalBundle.netRules.filter(rule => rule.type === 'netClass').map(rule => [
        rule.name, rule.sub.map(member => member.name),
    ]),
    [['OLD', ['SIG', 'SIG_N']]],
);
assert.equal(
    integratedIncrementalBundle.netRules.flatMap(rule => rule.type === 'net' ? [rule] : rule.sub)
        .filter(rule => rule.name === 'SIG').length,
    1,
    'an incremental per-net edit must not duplicate the native net root',
);

process.stdout.write('EasyEDA routing adapter: ok\n');
