import assert from 'node:assert/strict';
import { describe, it, type Mock, type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';

import { createPromptDeliveryPolicy, type PromptDeliveryPolicy } from '../src/prompt-delivery-policy.ts';
import type { PreparedPrompt, PromptHandlingResult } from '../src/prompt-task.ts';
import type { PromptMode } from '../src/types.ts';

type Harness = {
	policy: PromptDeliveryPolicy;
	execute: Mock<PreparedPrompt>;
	completion: PromiseWithResolvers<PromptHandlingResult>;
	started: Promise<void>;
	delivered: Promise<void>;
	deliveries: (PromptHandlingResult | undefined)[];
	run: (signal?: AbortSignal) => Promise<void>;
};

function createHarness(t: TestContext, mode: PromptMode): Harness {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const policy: PromptDeliveryPolicy = createPromptDeliveryPolicy(mode);
	const completion: PromiseWithResolvers<PromptHandlingResult> = Promise.withResolvers();
	const started: PromiseWithResolvers<void> = Promise.withResolvers();
	const delivered: PromiseWithResolvers<void> = Promise.withResolvers();
	const deliveries: (PromptHandlingResult | undefined)[] = [];
	const execute: Mock<PreparedPrompt> = t.mock.fn((): Promise<PromptHandlingResult> => {
		started.resolve();
		return completion.promise;
	});
	const runs: Promise<void>[] = [];
	t.after(async (): Promise<void> => {
		completion.resolve({});
		t.mock.timers.runAll();
		await Promise.allSettled(runs);
	});
	return {
		policy,
		execute,
		completion,
		started: started.promise,
		delivered: delivered.promise,
		deliveries,
		run: (signal = new AbortController().signal): Promise<void> => {
			const run: Promise<void> = policy.run(execute, signal, (result): void => {
				deliveries.push(result);
				delivered.resolve();
			});
			runs.push(run);
			// Observe failures immediately, preserving run for the test's rejection assertions.
			void Promise.allSettled([run]);
			return run;
		},
	};
}

async function isPending(run: Promise<void>): Promise<boolean> {
	// Let promise callbacks run without relying on a fixed number of microtasks.
	return (
		(await Promise.race([run.then((): string => 'settled'), setImmediate().then((): string => 'pending')])) ===
		'pending'
	);
}

void describe('prompt delivery policy', { timeout: 5000, concurrency: false }, (): void => {
	void it('waits for rewrite execution and delivers its result once', async (t: TestContext): Promise<void> => {
		// Arrange

		const harness: Harness = createHarness(t, 'rewrite');
		const result: PromptHandlingResult = { text: 'Polished prompt' };

		// Act

		const run: Promise<void> = harness.run();
		await harness.started;
		const pendingBeforeCompletion: boolean = await isPending(run);
		const earlyDeliveries: Harness['deliveries'] = [...harness.deliveries];

		harness.completion.resolve(result);
		await run;

		// Assert

		assert.equal(harness.policy.cancelWhenUnobserved, true);
		assert.equal(pendingBeforeCompletion, true);
		assert.deepEqual(earlyDeliveries, []);
		assert.equal(harness.execute.mock.callCount(), 1);
		assert.deepEqual(harness.deliveries, [result]);
	});

	void it('propagates rewrite execution failure without delivering', async (t: TestContext): Promise<void> => {
		// Arrange

		const harness: Harness = createHarness(t, 'rewrite');
		const failure: Error = new Error('Rewrite failed');

		// Act

		const run: Promise<void> = harness.run();
		const settled: Promise<PromiseSettledResult<void>[]> = Promise.allSettled([run]);

		await harness.started;
		harness.completion.reject(failure);

		// Assert

		await settled;
		await assert.rejects(run, (error: unknown): boolean => error === failure);
		assert.deepEqual(harness.deliveries, []);
	});

	void it('admits a proposal before deferred execution and waits for completion without redelivery', async (t: TestContext): Promise<void> => {
		// Arrange

		const harness: Harness = createHarness(t, 'proposal');

		// Act

		const run: Promise<void> = harness.run();
		const earlyDeliveries: Harness['deliveries'] = [...harness.deliveries];
		await harness.delivered;
		const pendingBeforeExecution: boolean = await isPending(run);
		const earlyExecutions: number = harness.execute.mock.callCount();

		t.mock.timers.runAll();
		await harness.started;
		const pendingBeforeCompletion: boolean = await isPending(run);

		harness.completion.resolve({ text: 'Background proposal' });
		await run;

		// Assert

		assert.equal(harness.policy.cancelWhenUnobserved, false);
		assert.deepEqual(earlyDeliveries, [undefined]);
		assert.equal(pendingBeforeExecution, true);
		assert.equal(earlyExecutions, 0);
		assert.equal(pendingBeforeCompletion, true);
		assert.equal(harness.execute.mock.callCount(), 1);
		assert.deepEqual(harness.deliveries, [undefined]);
	});

	for (const timing of ['before admission', 'after admission'] as const) {
		void it(`skips proposal execution when aborted ${timing}`, async (t: TestContext): Promise<void> => {
			// Arrange

			const controller: AbortController = new AbortController();
			const reason: Error = new Error('Proposal cancelled');
			if (timing === 'before admission') {
				controller.abort(reason);
			}
			const harness: Harness = createHarness(t, 'proposal');

			// Act

			const run: Promise<void> = harness.run(controller.signal);
			const settled: Promise<PromiseSettledResult<void>[]> = Promise.allSettled([run]);

			const earlyDeliveries: Harness['deliveries'] = [...harness.deliveries];
			await harness.delivered;
			if (timing === 'after admission') {
				controller.abort(reason);
			}
			t.mock.timers.runAll();

			// Assert

			await settled;
			await assert.rejects(run, (error: unknown): boolean => error === reason);
			assert.deepEqual(earlyDeliveries, [undefined]);
			assert.equal(harness.execute.mock.callCount(), 0);
			assert.deepEqual(harness.deliveries, [undefined]);
		});
	}

	void it('propagates proposal execution failure after early delivery', async (t: TestContext): Promise<void> => {
		// Arrange

		const harness: Harness = createHarness(t, 'proposal');
		const failure: Error = new Error('Proposal failed');

		// Act

		const run: Promise<void> = harness.run();
		const settled: Promise<PromiseSettledResult<void>[]> = Promise.allSettled([run]);

		await harness.delivered;
		const earlyDeliveries: Harness['deliveries'] = [...harness.deliveries];
		t.mock.timers.runAll();
		await harness.started;
		harness.completion.reject(failure);

		// Assert

		await settled;
		await assert.rejects(run, (error: unknown): boolean => error === failure);
		assert.deepEqual(earlyDeliveries, [undefined]);
		assert.deepEqual(harness.deliveries, [undefined]);
	});
});
