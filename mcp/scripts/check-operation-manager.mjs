import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const { OperationManager } = await import(
    pathToFileURL(resolve('dist/operations/manager.js')).href
);
const { routingResultBlocksApplication } = await import(
    pathToFileURL(resolve('dist/routing/routing-operation.js')).href
);

assert.equal(routingResultBlocksApplication({ status: 'complete' }), false);
assert.equal(routingResultBlocksApplication({ status: 'partial' }), false,
    'partial copper must reach the EasyEDA apply transaction');
assert.equal(routingResultBlocksApplication({ status: 'error' }), true);

const manager = new OperationManager();
const completedId = manager.start('pcb-dsl', async ({ id }) => ({ ok: true, operation_id: id }));
const completed = await manager.wait(completedId, 1000);
assert.deepEqual(completed, { ok: true, operation_id: completedId });

let release;
const pendingId = manager.start('pcb-layout', async () => {
    await new Promise(resolvePromise => { release = resolvePromise; });
    return { ok: true };
}, { resource: 'pcb' });
const pending = await manager.wait(pendingId, 1);
assert.equal(pending.status, 'running');
assert.equal(pending.operation_id, pendingId);
assert.throws(
    () => manager.start('pcb-dsl', async () => ({}), { resource: 'pcb' }),
    /already using pcb/,
);
release();
await manager.wait(pendingId, 1000);

let cancelled = false;
let markCancelledOperationStarted;
const cancelledOperationStarted = new Promise(resolvePromise => {
    markCancelledOperationStarted = resolvePromise;
});
const cancelledId = manager.start('pcb-dsl', async ({ signal, onCancel }) => {
    onCancel(() => { cancelled = true; });
    markCancelledOperationStarted();
    await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
});
await cancelledOperationStarted;
const cancelResult = await manager.cancel(cancelledId);
assert.equal(cancelResult.status, 'cancel_requested');
assert.equal(cancelled, true);
await assert.rejects(() => manager.wait(cancelledId, 1000), /cancel/i);

let preStartRunnerCalled = false;
const preStartCancelledId = manager.start('pcb-dsl', async () => {
    preStartRunnerCalled = true;
});
await manager.cancel(preStartCancelledId);
await assert.rejects(() => manager.wait(preStartCancelledId, 1000), /cancel/i);
assert.equal(preStartRunnerCalled, false);

await assert.rejects(() => manager.wait('pcb-dsl:00000000', 1), /not found/i);

process.stdout.write('Operation manager: ok\n');
