import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';

import { createPendingWorkTracker, type PendingWorkTracker } from '../src/pending-work-tracker.ts';

type ControlledWork = PromiseWithResolvers<void>;

function createTracker(t: TestContext): PendingWorkTracker {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	return createPendingWorkTracker();
}

function createWork(t: TestContext): ControlledWork {
	const work: ControlledWork = Promise.withResolvers();
	t.after((): void => {
		work.resolve();
	});
	return work;
}

async function isPending(task: Promise<void>): Promise<boolean> {
	// An event-loop checkpoint lets promise callbacks run without counting microtasks.
	return (
		(await Promise.race([task.then((): string => 'settled'), setImmediate().then((): string => 'pending')])) ===
		'pending'
	);
}

void describe('pending work tracker', { timeout: 5000, concurrency: false }, (): void => {
	void it('drains an empty tracker without waiting for the deadline', async (t: TestContext): Promise<void> => {
		// Arrange

		const tracker: PendingWorkTracker = createTracker(t);

		// Act

		const drain: Promise<void> = tracker.drain();

		// Assert

		await assert.doesNotReject(drain);
	});

	void it('waits for every task and tolerates rejection', async (t: TestContext): Promise<void> => {
		// Arrange

		const tracker: PendingWorkTracker = createTracker(t);
		const first: ControlledWork = createWork(t);
		const failing: ControlledWork = createWork(t);
		const last: ControlledWork = createWork(t);
		tracker.track(first.promise);
		tracker.track(failing.promise);
		tracker.track(last.promise);
		// Act

		const drain: Promise<void> = tracker.drain();

		first.resolve();
		failing.reject(new Error('Controlled work failure'));
		const pendingBeforeLastTask: boolean = await isPending(drain);

		last.resolve();
		await drain;

		// Assert

		assert.equal(pendingBeforeLastTask, true);
	});

	void it('includes follow-up work registered while the initial batch settles', async (t: TestContext): Promise<void> => {
		// Arrange

		const tracker: PendingWorkTracker = createTracker(t);
		const initial: ControlledWork = createWork(t);
		const followUp: ControlledWork = createWork(t);
		tracker.track(initial.promise);
		const registration: Promise<void> = initial.promise.then((): void => {
			tracker.track(followUp.promise);
		});
		// Act

		const drain: Promise<void> = tracker.drain();

		initial.resolve();
		await registration;
		const pendingBeforeFollowUp: boolean = await isPending(drain);

		followUp.resolve();
		await drain;

		// Assert

		assert.equal(pendingBeforeFollowUp, true);
	});

	void it('bounds all batches by one overall two-second deadline', async (t: TestContext): Promise<void> => {
		// Arrange

		const tracker: PendingWorkTracker = createTracker(t);
		const initial: ControlledWork = createWork(t);
		const followUp: ControlledWork = createWork(t);
		tracker.track(initial.promise);
		const registration: Promise<void> = initial.promise.then((): void => {
			tracker.track(followUp.promise);
		});
		// Act

		const drain: Promise<void> = tracker.drain();

		t.mock.timers.tick(1500);
		initial.resolve();
		await registration;
		const pendingAfterInitialBatch: boolean = await isPending(drain);

		t.mock.timers.tick(499);
		const pendingBeforeDeadline: boolean = await isPending(drain);

		t.mock.timers.tick(1);
		await drain;
		// Follow-up work is deliberately left unfinished until teardown.

		// Assert

		assert.equal(pendingAfterInitialBatch, true);
		assert.equal(pendingBeforeDeadline, true);
	});

	void it('shares the same drain promise during and after completion', async (t: TestContext): Promise<void> => {
		// Arrange

		const tracker: PendingWorkTracker = createTracker(t);
		const work: ControlledWork = createWork(t);
		tracker.track(work.promise);
		// Act

		const drain: Promise<void> = tracker.drain();

		const concurrentDrain: Promise<void> = tracker.drain();
		const pendingBeforeCompletion: boolean = await isPending(drain);
		work.resolve();
		await drain;
		const completedDrain: Promise<void> = tracker.drain();

		// Assert

		assert.equal(concurrentDrain, drain);
		assert.equal(pendingBeforeCompletion, true);
		assert.equal(completedDrain, drain);
	});

	void it('observes task rejection after the drain deadline', async (t: TestContext): Promise<void> => {
		// Arrange

		const tracker: PendingWorkTracker = createTracker(t);
		const work: ControlledWork = createWork(t);
		tracker.track(work.promise);
		// Act

		const drain: Promise<void> = tracker.drain();

		t.mock.timers.tick(2000);
		await drain;
		work.reject(new Error('Controlled failure after drain timeout'));
		// Do not catch work.promise: an unhandled rejection must fail this test.

		// Assert

		await assert.doesNotReject(setImmediate());
	});
});
