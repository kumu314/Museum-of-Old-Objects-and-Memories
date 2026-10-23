import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createInspectionController,
  type InspectionState,
} from './inspection-controller.ts';

test('selection and return follow all four phases', () => {
  const controller = createInspectionController(['camera']);
  assert.deepEqual(controller.getSnapshot(), {
    phase: 'overview',
    selectedId: null,
    transitionId: 0,
  });

  controller.select('camera');
  assert.deepEqual(controller.getSnapshot(), {
    phase: 'focusing',
    selectedId: 'camera',
    transitionId: 1,
  });
  controller.finishTransition(1);
  assert.deepEqual(controller.getSnapshot(), {
    phase: 'inspecting',
    selectedId: 'camera',
    transitionId: 1,
  });

  controller.returnToOverview();
  assert.deepEqual(controller.getSnapshot(), {
    phase: 'returning',
    selectedId: 'camera',
    transitionId: 2,
  });
  controller.finishTransition(2);
  assert.deepEqual(controller.getSnapshot(), {
    phase: 'overview',
    selectedId: null,
    transitionId: 2,
  });
});

test('quick selection invalidates the previous focus completion', () => {
  const controller = createInspectionController(['camera', 'tape', 'ticket']);
  controller.select('camera');
  const firstTransition = controller.getSnapshot().transitionId;
  controller.select('tape');
  const secondTransition = controller.getSnapshot().transitionId;
  controller.select('ticket');
  const latestSnapshot = controller.getSnapshot();

  assert.ok(firstTransition < secondTransition);
  assert.ok(secondTransition < latestSnapshot.transitionId);
  controller.finishTransition(firstTransition);
  controller.finishTransition(secondTransition);
  assert.equal(controller.getSnapshot(), latestSnapshot);

  controller.finishTransition(latestSnapshot.transitionId);
  assert.equal(controller.getSnapshot().phase, 'inspecting');
  assert.equal(controller.getSnapshot().selectedId, 'ticket');
});

test('return interrupts focusing without accepting the old completion', () => {
  const controller = createInspectionController(['camera']);
  controller.select('camera');
  const focusTransition = controller.getSnapshot().transitionId;
  controller.returnToOverview();
  const returnSnapshot = controller.getSnapshot();

  controller.finishTransition(focusTransition);
  assert.equal(controller.getSnapshot(), returnSnapshot);
  assert.equal(returnSnapshot.phase, 'returning');
  assert.equal(returnSnapshot.selectedId, 'camera');
  controller.finishTransition(returnSnapshot.transitionId);
  assert.equal(controller.getSnapshot().phase, 'overview');
  assert.equal(controller.getSnapshot().selectedId, null);
});

test('selecting during return starts a new focus and ignores the old return', () => {
  const controller = createInspectionController(['camera', 'tape']);
  controller.select('camera');
  controller.finishTransition(controller.getSnapshot().transitionId);
  controller.returnToOverview();
  const returnTransition = controller.getSnapshot().transitionId;
  controller.select('tape');
  const newFocusSnapshot = controller.getSnapshot();

  assert.equal(newFocusSnapshot.phase, 'focusing');
  assert.equal(newFocusSnapshot.selectedId, 'tape');
  assert.ok(newFocusSnapshot.transitionId > returnTransition);
  controller.finishTransition(returnTransition);
  assert.equal(controller.getSnapshot(), newFocusSnapshot);
  controller.finishTransition(newFocusSnapshot.transitionId);
  assert.equal(controller.getSnapshot().phase, 'inspecting');
});

test('selecting the same item during return also restarts focusing', () => {
  const controller = createInspectionController(['camera']);
  controller.select('camera');
  controller.returnToOverview();
  const returnTransition = controller.getSnapshot().transitionId;
  controller.select('camera');

  assert.deepEqual(controller.getSnapshot(), {
    phase: 'focusing',
    selectedId: 'camera',
    transitionId: returnTransition + 1,
  });
});

test('duplicate selections and returns leave snapshots and notifications alone', () => {
  const controller = createInspectionController(['camera']);
  let notifications = 0;
  controller.subscribe(() => {
    notifications += 1;
  });

  const initialSnapshot = controller.getSnapshot();
  controller.returnToOverview();
  controller.finishTransition(initialSnapshot.transitionId);
  assert.equal(controller.getSnapshot(), initialSnapshot);
  assert.equal(notifications, 0);

  controller.select('camera');
  const focusSnapshot = controller.getSnapshot();
  controller.select('camera');
  assert.equal(controller.getSnapshot(), focusSnapshot);
  assert.equal(notifications, 1);

  controller.finishTransition(focusSnapshot.transitionId);
  const inspectingSnapshot = controller.getSnapshot();
  controller.select('camera');
  controller.finishTransition(inspectingSnapshot.transitionId);
  assert.equal(controller.getSnapshot(), inspectingSnapshot);
  assert.equal(notifications, 2);

  controller.returnToOverview();
  const returnSnapshot = controller.getSnapshot();
  controller.returnToOverview();
  assert.equal(controller.getSnapshot(), returnSnapshot);
  assert.equal(notifications, 3);

  controller.finishTransition(returnSnapshot.transitionId);
  const overviewSnapshot = controller.getSnapshot();
  controller.finishTransition(returnSnapshot.transitionId);
  controller.returnToOverview();
  assert.equal(controller.getSnapshot(), overviewSnapshot);
  assert.equal(notifications, 4);
});

test('subscribers observe the new snapshot synchronously and can unsubscribe', () => {
  const controller = createInspectionController(['camera']);
  const snapshots: InspectionState[] = [];
  const unsubscribe = controller.subscribe(() => {
    snapshots.push(controller.getSnapshot());
  });

  controller.select('camera');
  assert.deepEqual(snapshots, [controller.getSnapshot()]);
  controller.finishTransition(controller.getSnapshot().transitionId);
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots.at(-1), controller.getSnapshot());

  unsubscribe();
  unsubscribe();
  controller.returnToOverview();
  assert.equal(snapshots.length, 2);
});

test('invalid IDs throw RangeError without changing selection or notifying', () => {
  const controller = createInspectionController(['camera']);
  let notifications = 0;
  controller.subscribe(() => {
    notifications += 1;
  });
  controller.select('camera');
  const snapshot = controller.getSnapshot();

  assert.throws(() => controller.select('missing'), RangeError);
  assert.equal(controller.getSnapshot(), snapshot);
  assert.equal(notifications, 1);
});

test('an empty cabinet remains in overview and rejects every selection', () => {
  const controller = createInspectionController([]);
  assert.throws(() => controller.select('camera'), RangeError);
  controller.returnToOverview();
  controller.finishTransition(0);
  assert.deepEqual(controller.getSnapshot(), {
    phase: 'overview',
    selectedId: null,
    transitionId: 0,
  });
});
