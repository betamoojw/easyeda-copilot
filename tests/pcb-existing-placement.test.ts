import assert from 'node:assert/strict';
import test from 'node:test';
import { easyEdaPointToPlacement } from '../src/eda/pcb-existing-placement.ts';

test('converts EasyEDA y-up coordinates to placement y-down coordinates', () => {
    const origin = { x: 100, y: 50 };

    assert.deepEqual(easyEdaPointToPlacement({ x: 104, y: 58 }, origin), { x: 4, y: -8 });
    assert.deepEqual(easyEdaPointToPlacement({ x: 96, y: 43 }, origin), { x: -4, y: 7 });
    assert.deepEqual(easyEdaPointToPlacement({ x: 104.26, y: 58.24 }, origin), { x: 4.3, y: -8.2 });
});

test('converts an asymmetric board outline with the same transform as components', () => {
    const origin = { x: 5, y: 4 };
    const board = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 6 },
        { x: 7, y: 8 },
        { x: 0, y: 8 },
    ];

    assert.deepEqual(board.map(point => easyEdaPointToPlacement(point, origin)), [
        { x: -5, y: 4 },
        { x: 5, y: 4 },
        { x: 5, y: -2 },
        { x: 2, y: -4 },
        { x: -5, y: -4 },
    ]);
    assert.deepEqual(easyEdaPointToPlacement({ x: 7, y: 7 }, origin), { x: 2, y: -3 });
});
