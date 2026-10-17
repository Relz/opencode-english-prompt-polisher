import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { withCheckerSession } from '../../src/checker/session-lifecycle.ts';

type SessionContext = Parameters<typeof withCheckerSession>[0];
type SessionRequest = Parameters<typeof withCheckerSession>[1];
type CheckResult = { text: string };
type Run = (sessionID: string) => Promise<CheckResult>;

type TrackedRemoval = {
	promise: Promise<void>;
	settled: boolean;
};

type Harness = {
	ctx: SessionContext;
	createCalls: SessionRequest['create'][];
	removeCalls: Parameters<SessionContext['session']['remove']>[0][];
	runCalls: string[];
	tracked: TrackedRemoval[];
	run: Run;
};

const SESSION_ID: string = 'checker-session';
const RESULT: CheckResult = { text: 'Polished prompt' };
const REQUEST: SessionRequest = {
	create: { title: 'Checker test session', parentID: 'source-session' },
	deleteSession: true,
};

function createHarness(options: Partial<SessionContext['session']> & { run?: Run } = {}): Harness {
	const createCalls: Harness['createCalls'] = [];
	const removeCalls: Harness['removeCalls'] = [];
	const runCalls: string[] = [];
	const tracked: TrackedRemoval[] = [];
	return {
		ctx: {
			session: {
				create: (request): Promise<{ id: string }> => {
					createCalls.push(request);
					return options.create?.(request) ?? Promise.resolve({ id: SESSION_ID });
				},
				remove: (request): Promise<void> => {
					removeCalls.push(request);
					return options.remove?.(request) ?? Promise.resolve();
				},
			},
			registerPendingWork: (promise): void => {
				const entry: TrackedRemoval = { promise, settled: false };
				tracked.push(entry);
				// Observe failures immediately; assertions still await the original promise.
				void promise.then(
					(): void => {
						entry.settled = true;
					},
					(): void => {
						entry.settled = true;
					},
				);
			},
		},
		createCalls,
		removeCalls,
		runCalls,
		tracked,
		run: (sessionID): Promise<CheckResult> => {
			runCalls.push(sessionID);
			return options.run?.(sessionID) ?? Promise.resolve(RESULT);
		},
	};
}

async function assertRemoved(harness: Harness): Promise<void> {
	assert.equal(harness.tracked.length, 1, 'removal must be registered exactly once');
	await harness.tracked[0].promise;
	assert.deepEqual(harness.removeCalls, [{ sessionID: SESSION_ID }]);
}

void describe('withCheckerSession', { timeout: 5000 }, (): void => {
	void it('passes creation options and the acquired ID through, preserving the result and cleaning up', async (): Promise<void> => {
		// Arrange

		const harness: Harness = createHarness();

		// Act

		const result: CheckResult = await withCheckerSession(harness.ctx, REQUEST, harness.run);

		// Assert

		assert.equal(result, RESULT);
		assert.deepEqual(harness.createCalls, [REQUEST.create]);
		assert.deepEqual(harness.runCalls, [SESSION_ID]);
		await assertRemoved(harness);
	});

	for (const outcome of ['success', 'failure'] as const) {
		void it(`keeps the session when deletion is disabled after run ${outcome}`, async (): Promise<void> => {
			// Arrange

			const failure: Error = new Error('Check failed');
			const harness: Harness = createHarness({
				run: (): Promise<CheckResult> =>
					outcome === 'success' ? Promise.resolve(RESULT) : Promise.reject(failure),
			});

			// Act

			const result: Promise<CheckResult> = withCheckerSession(
				harness.ctx,
				{ ...REQUEST, deleteSession: false },
				harness.run,
			);

			// Assert

			if (outcome === 'success') {
				assert.equal(await result, RESULT);
			} else {
				await assert.rejects(result, (error: unknown): boolean => error === failure);
			}
			assert.deepEqual(harness.runCalls, [SESSION_ID]);
			assert.deepEqual(harness.removeCalls, []);
			assert.deepEqual(harness.tracked, []);
		});
	}

	void it('preserves creation failures without running work or scheduling cleanup', async (): Promise<void> => {
		// Arrange

		const failure: Error = new Error('Creation failed');
		const harness: Harness = createHarness({ create: (): Promise<{ id: string }> => Promise.reject(failure) });

		// Act

		const result: Promise<CheckResult> = withCheckerSession(harness.ctx, REQUEST, harness.run);

		// Assert

		await assert.rejects(result, (error: unknown): boolean => error === failure);

		assert.deepEqual(harness.runCalls, []);
		assert.deepEqual(harness.removeCalls, []);
		assert.deepEqual(harness.tracked, []);
	});

	void it('preserves run failures while cleaning up the acquired session', async (): Promise<void> => {
		// Arrange

		const failure: Error = new Error('Check failed');
		const harness: Harness = createHarness({ run: (): Promise<CheckResult> => Promise.reject(failure) });

		// Act

		const result: Promise<CheckResult> = withCheckerSession(harness.ctx, REQUEST, harness.run);

		// Assert

		await assert.rejects(result, (error: unknown): boolean => error === failure);

		await assertRemoved(harness);
	});

	void it('rejects a pre-aborted request without acquiring a session', async (): Promise<void> => {
		// Arrange

		const harness: Harness = createHarness();
		const controller: AbortController = new AbortController();
		const reason: Error = new Error('Cancelled before creation');
		controller.abort(reason);

		// Act

		const result: Promise<CheckResult> = withCheckerSession(
			harness.ctx,
			{ ...REQUEST, signal: controller.signal },
			harness.run,
		);

		// Assert

		await assert.rejects(result, (error: unknown): boolean => error === reason);

		assert.deepEqual(harness.createCalls, []);
		assert.deepEqual(harness.runCalls, []);
		assert.deepEqual(harness.removeCalls, []);
		assert.deepEqual(harness.tracked, []);
	});

	void it('receives and cleans up an ID acquired during cancellation without running work', async (): Promise<void> => {
		// Arrange

		const creation: PromiseWithResolvers<{ id: string }> = Promise.withResolvers();
		const harness: Harness = createHarness({ create: (): Promise<{ id: string }> => creation.promise });
		const controller: AbortController = new AbortController();
		const reason: Error = new Error('Cancelled during creation');

		// Act

		const result: Promise<CheckResult> = withCheckerSession(
			harness.ctx,
			{ ...REQUEST, signal: controller.signal },
			harness.run,
		);
		const settled: Promise<PromiseSettledResult<CheckResult>[]> = Promise.allSettled([result]);

		const creationCount: number = harness.createCalls.length;
		controller.abort(reason);
		creation.resolve({ id: SESSION_ID });

		// Assert

		await settled;
		await assert.rejects(result, (error: unknown): boolean => error === reason);
		assert.equal(creationCount, 1);
		assert.deepEqual(harness.runCalls, []);
		await assertRemoved(harness);
	});

	void it('rejects a successful run result when cancellation occurs during the run, and cleans up', async (): Promise<void> => {
		// Arrange

		const started: PromiseWithResolvers<void> = Promise.withResolvers();
		const execution: PromiseWithResolvers<CheckResult> = Promise.withResolvers();
		const harness: Harness = createHarness({
			run: (): Promise<CheckResult> => {
				started.resolve();
				return execution.promise;
			},
		});
		const controller: AbortController = new AbortController();
		const reason: Error = new Error('Cancelled during run');

		// Act

		const result: Promise<CheckResult> = withCheckerSession(
			harness.ctx,
			{ ...REQUEST, signal: controller.signal },
			harness.run,
		);
		const settled: Promise<PromiseSettledResult<CheckResult>[]> = Promise.allSettled([result]);

		await started.promise;
		controller.abort(reason);
		execution.resolve(RESULT);

		// Assert

		await settled;
		await assert.rejects(result, (error: unknown): boolean => error === reason);
		await assertRemoved(harness);
	});

	void it('returns before removal finishes while tracking removal until completion', async (): Promise<void> => {
		// Arrange

		const started: PromiseWithResolvers<void> = Promise.withResolvers();
		const removal: PromiseWithResolvers<void> = Promise.withResolvers();
		const harness: Harness = createHarness({
			remove: (): Promise<void> => {
				started.resolve();
				return removal.promise;
			},
		});

		// Act

		let result: CheckResult;
		let trackedCount: number;
		let settledBeforeRemoval: boolean;
		let removeCalls: Harness['removeCalls'];
		try {
			result = await withCheckerSession(harness.ctx, REQUEST, harness.run);
			await started.promise;
			trackedCount = harness.tracked.length;
			settledBeforeRemoval = harness.tracked[0].settled;
			removeCalls = [...harness.removeCalls];
		} finally {
			removal.resolve();
			await Promise.all(harness.tracked.map((entry): Promise<void> => entry.promise));
		}

		// Assert

		assert.equal(result, RESULT);
		assert.equal(trackedCount, 1);
		assert.equal(settledBeforeRemoval, false);
		assert.deepEqual(removeCalls, [{ sessionID: SESSION_ID }]);
		assert.equal(harness.tracked[0].settled, true);
	});

	for (const mode of ['synchronous throw', 'rejected promise'] as const) {
		for (const outcome of ['success', 'failure'] as const) {
			void it(`contains removal ${mode} without masking run ${outcome}`, async (): Promise<void> => {
				// Arrange

				const runFailure: Error = new Error('Check failed');
				const removalFailure: Error = new Error('Removal failed');
				const harness: Harness = createHarness({
					run: (): Promise<CheckResult> =>
						outcome === 'success' ? Promise.resolve(RESULT) : Promise.reject(runFailure),
					remove: (): Promise<void> => {
						if (mode === 'synchronous throw') {
							throw removalFailure;
						}
						return Promise.reject(removalFailure);
					},
				});

				// Act

				const result: Promise<CheckResult> = withCheckerSession(harness.ctx, REQUEST, harness.run);

				// Assert

				if (outcome === 'success') {
					assert.equal(await result, RESULT);
				} else {
					await assert.rejects(result, (error: unknown): boolean => error === runFailure);
				}
				await assertRemoved(harness);
			});
		}
	}
});
