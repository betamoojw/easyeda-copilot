import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const adapter = await import(pathToFileURL(resolve('dist/routing/easyeda-autoroute-adapter.js')).href);
const drcAdapter = await import(pathToFileURL(resolve('dist/routing/easyeda-drc-adapter.js')).href);

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
            name: 'U1', footprint: 'fp', layer: 1, location: [1, 2], rotation: 90,
            nets: { p0: 'SIG', p1: 'SIG' }, pinName: { p0: '1', p1: '1' },
        },
    },
    footprints: {
        fp: {
            pads: {
                p0: { number: '1', layers: [1], location: [1, 0], path: [[0.5, -0.5], [1.5, -0.5], [1.5, 0.5], [0.5, 0.5]] },
                p1: { number: '1', layers: [1], location: [-1, 0], path: [[-1.5, -0.5], [-0.5, -0.5], [-0.5, 0.5], [-1.5, 0.5]] },
            },
        },
    },
    tracks: [{ id: 'old', net: 'SIG', layer: 1, width: 0.2, path: [[1, 1], [2, 1]] }],
    vias: [], fillRegions: [], prohibitedRegions: [],
};

const imported = adapter.importEasyEdaAutorouteJson(fixture);
assert.ok(imported.board, JSON.stringify(imported.diagnostics));
assert.equal(imported.diagnostics.filter(item => item.severity === 'error').length, 0);
assert.equal(imported.board.pads.length, 2, 'duplicate logical pad numbers are physical pads, not an error');
assert.deepEqual(imported.board.pads.map(item => item.at), [{ x: 1, y: -3 }, { x: 1, y: -1 }]);
assert.equal(imported.board.copper.editable.tracks.length, 1);
assert.equal(imported.board.copper.fixed.tracks.length, 0);
assert.equal(imported.board.rules.nets[0].values.preferredTrackWidthMm, 0.25);
assert.deepEqual(imported.board.rules.differentialPairs, [{ id: 'pair', positive: 'SIG', negative: 'SIG_N' }]);

const application = adapter.routingResultToEasyEdaApplication({
    status: 'complete', operation: 'route',
    rules: { effective: imported.board.rules, applyRequested: false, overriddenFields: [] },
    copper: {
        tracks: [{ net: 'SIG', layer: 'TOP', widthMm: 0.2, points: [{ x: 1, y: -3 }, { x: 2, y: -3 }] }],
        vias: [{ net: 'SIG', at: { x: 2, y: -3 }, diameterMm: 0.6, drillMm: 0.3, fromLayer: 'TOP', toLayer: 'BOTTOM' }],
        zones: [],
    },
    diagnostics: [], metrics: { elapsedMs: 1 }, requiresNativeVerification: true,
});
assert.deepEqual(application.autorouteResult.traces[0].path, [[1, 3], [2, 3]]);
assert.deepEqual(application.autorouteResult.vias[0].location, [2, 3]);
assert.equal(application.diagnostics.length, 0);

const values = {
    clearanceMm: 0.22, edgeClearanceMm: 0.5,
    minTrackWidthMm: 0.2, preferredTrackWidthMm: 0.3,
    via: { minDiameterMm: 0.6, preferredDiameterMm: 0.7, minDrillMm: 0.3, preferredDrillMm: 0.35 },
    differential: { trackWidthMm: 0.2, gapMm: 0.25, maxSkewMm: 0.1 },
};
const translated = drcAdapter.routingRulesToEasyEdaDrcBundle({
    ruleConfiguration: {
        Physics: {
            Track: { default: { editName: 'default', form: { data: { '1': { minValue: 0.1, defaultValue: 0.2, maxValue: 1 } } } } },
            'Via Size': { default: { editName: 'default', viaOuterdiameterMin: 0.5, viaOuterdiameterDefault: 0.6, viaOuterdiameterMax: 1, viaInnerdiameterMin: 0.2, viaInnerdiameterDefault: 0.3, viaInnerdiameterMax: 0.5 } },
            'Net Length Range': { default: { editName: 'default', netLengthMax: 100 } },
            'Net Length Tolerance': { default: { editName: 'default', netLengthTolerance: 1 } },
            'Differential Pair': { default: { editName: 'default', strokeWidthTables: { 1: [0.2] }, diffPairSpacingTables: { 1: [0.2] }, differentailPairLenTolerMax: 1 } },
        },
        Spacing: { 'Safe Spacing': { default: { editName: 'default', tables: { 1: { content: [[0.2, 0.2]] } } } } },
    },
    netRules: [{ type: 'net', name: 'SIG' }, { type: 'net', name: 'SIG_N' }],
}, {
    default: values,
    nets: [{ net: 'SIG', values }, { net: 'SIG_N', values }],
    differentialPairs: [{ id: 'pair', positive: 'SIG', negative: 'SIG_N' }],
});
assert.equal(translated.netRules.length, 1);
assert.equal(translated.netRules[0].type, 'differentialPair');
assert.equal(translated.netRules[0].sub.length, 2);
assert.equal(translated.ruleConfiguration.Physics.Track.copilot_router_0_track.form.data['1'].defaultValue, 0.3);
assert.equal(translated.ruleConfiguration.Spacing['Safe Spacing'].copilot_router_0_spacing.tables['1'].content[0][0], 0.22);

process.stdout.write('EasyEDA routing adapter: ok\n');
