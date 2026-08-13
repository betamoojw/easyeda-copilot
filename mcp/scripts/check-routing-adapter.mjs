import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const adapter = await import(pathToFileURL(resolve('dist/routing/easyeda-autoroute-adapter.js')).href);

const fixture = {
    boardOutline: { path: [[-5, -5], [5, -5], [5, 5], [-5, 5], [-5, -5]] },
    layers: { route: [1, 2], notRoute: [] },
    rules: {
        safeClearances: { cls: [{ layers: [1, 2], trackToTrack: 0.2, trackToBoardOutline: 0.5 }] },
        trackWidths: { cls: [{ layers: [1, 2], trackWidth: [0.2, 0.25, 0.3] }] },
        viaSizes: { via_cls: [0.6, 0.3] },
        differentialPairs: {},
    },
    nets: [{ net: 'SIG', safeClearance: 'cls', trackWidth: 'cls', viaSize: 'via_cls' }],
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

process.stdout.write('EasyEDA routing adapter: ok\n');
