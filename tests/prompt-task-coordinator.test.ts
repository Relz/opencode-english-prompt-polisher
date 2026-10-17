import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';

import type { WriteLog } from 'english-prompt-polisher';

import type { PromptDeliveryPolicy } from '../src/prompt-delivery-policy.ts';
import { createPromptTaskCoordinator, type PromptTaskCoordinator } from '../src/prompt-task-coordinator.ts';
import type { PreparedPrompt, PromptHandlingResult, PromptRequest } from '../src/prompt-task.ts';

type Preparation = {
	request: PromptRequest;
	signal: AbortSignal;
};

type Delivery = {
	signal: AbortSignal;
	deliver: (result: PromptHandlingResult | undefined) => void;
};

type ControlledWork = {
	execute: PreparedPrompt;
	started: PromiseWithResolvers<Preparation>;
	preparation: PromiseWithResolvers<PreparedPrompt | undefined>;
	delivery: PromiseWithResolvers<Delivery>;
	finish: PromiseWithResolvers<void>;
};

type TrackedWork = {
	promise: Promise<void>;
	settled: boolean;
};

type Harness = {
	coordinator: PromptTaskCoordinator;
	preparations: Preparation[];
	deliveries: Delivery[];
	tracked: TrackedWork[];
	logs: Parameters<WriteLog>[];
	addWork: () => ControlledWork;
};

const REQUEST: PromptRequest = {
	sessionID: 'session-1',
	messageID: 'message-1',
	text: 'Please polish this prompt.',
};

function createHarness(t: TestContext, cancelWhenUnobserved: boolean = true): Harness {
	const works: ControlledWork[] = [];
	const queued: ControlledWork[] = [];
	const preparations: Preparation[] = [];
	const deliveries: Delivery[] = [];
	const tracked: TrackedWork[] = [];
	const logs: Parameters<WriteLog>[] = [];
	const policy: PromptDeliveryPolicy = {
		cancelWhenUnobserved,
		run: (execute, signal, deliver): Promise<void> => {
			const work: ControlledWork | undefined = works.find((candidate): boolean => candidate.execute === execute);
			assert.ok(work, 'delivery must receive the prepared executable');
			const delivery: Delivery = { signal, deliver };
			deliveries.push(delivery);
			work.delivery.resolve(delivery);
			return work.finish.promise;
		},
	};
	const coordinator: PromptTaskCoordinator = createPromptTaskCoordinator(
		policy,
		(request, signal): Promise<PreparedPrompt | undefined> => {
			const work: ControlledWork | undefined = queued.shift();
			assert.ok(work, 'unexpected preparation: no work was queued');
			const preparation: Preparation = { request, signal };
			preparations.push(preparation);
			work.started.resolve(preparation);
			return work.preparation.promise;
		},
		{
			track: (promise): void => {
				const entry: TrackedWork = { promise, settled: false };
				tracked.push(entry);
				// Observe failures immediately, while preserving the original promise for assertions.
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
		(...args): Promise<void> => {
			logs.push(args);
			return Promise.resolve();
		},
	);
	t.after(async (): Promise<void> => {
		coordinator.stop();
		for (const work of works) {
			work.preparation.resolve(undefined);
			work.finish.resolve();
		}
		await Promise.allSettled(tracked.map((entry): Promise<void> => entry.promise));
	});
	return {
		coordinator,
		preparations,
		deliveries,
		tracked,
		logs,
		addWork: (): ControlledWork => {
			const finish: PromiseWithResolvers<void> = Promise.withResolvers();
			const work: ControlledWork = {
				execute: (): Promise<PromptHandlingResult> => Promise.resolve({}),
				started: Promise.withResolvers<Preparation>(),
				preparation: Promise.withResolvers<PreparedPrompt | undefined>(),
				delivery: Promise.withResolvers<Delivery>(),
				finish,
			};
			works.push(work);
			queued.push(work);
			return work;
		},
	};
}

function admit(harness: Harness, request: PromptRequest = REQUEST): Promise<string | undefined> {
	return harness.coordinator.admit(request, new AbortController().signal);
}

async function startDelivery(work: ControlledWork): Promise<Delivery> {
	await work.started.promise;
	work.preparation.resolve(work.execute);
	return work.delivery.promise;
}

void describe('prompt task coordinator', { timeout: 5000 }, (): void => {
	void it('shares preparation, delivery, and pending work for equivalent concurrent admissions', async (t: TestContext): Promise<void> => {
		// Arrange

		const harness: Harness = createHarness(t);
		const work: ControlledWork = harness.addWork();

		// Act

		const first: Promise<string | undefined> = admit(harness, { ...REQUEST });
		const second: Promise<string | undefined> = admit(harness, { ...REQUEST });
		const delivery: Delivery = await startDelivery(work);

		delivery.deliver({ text: 'Polished prompt' });
		work.finish.resolve();

		// Assert

		assert.deepEqual(await Promise.all([first, second]), ['Polished prompt', 'Polished prompt']);
		assert.equal(harness.preparations.length, 1);
		assert.equal(harness.deliveries.length, 1);
		assert.equal(harness.tracked.length, 1);
		await harness.tracked[0].promise;
	});

	const distinctRequests: { name: string; request: PromptRequest }[] = [
		{ name: 'session', request: { ...REQUEST, sessionID: 'session-2' } },
		{ name: 'message', request: { ...REQUEST, messageID: 'message-2' } },
		{ name: 'missing message', request: { sessionID: REQUEST.sessionID, text: REQUEST.text } },
		{ name: 'text', request: { ...REQUEST, text: 'A different prompt.' } },
	];
	for (const { name, request } of distinctRequests) {
		void it(`keeps requests with a different ${name} independent`, async (t: TestContext): Promise<void> => {
			// Arrange

			const harness: Harness = createHarness(t);
			const firstWork: ControlledWork = harness.addWork();
			const secondWork: ControlledWork = harness.addWork();

			// Act

			const first: Promise<string | undefined> = admit(harness);
			const second: Promise<string | undefined> = admit(harness, request);
			const firstDelivery: Delivery = await startDelivery(firstWork);
			const secondDelivery: Delivery = await startDelivery(secondWork);

			firstDelivery.deliver({ text: 'First result' });
			secondDelivery.deliver({ text: 'Second result' });
			firstWork.finish.resolve();
			secondWork.finish.resolve();

			// Assert

			assert.deepEqual(await Promise.all([first, second]), ['First result', 'Second result']);
			assert.equal(harness.preparations.length, 2);
			assert.equal(harness.tracked.length, 2);
		});
	}

	void it('snapshots the request before asynchronous preparation and preserves its original identity', async (t: TestContext): Promise<void> => {
		// Arrange

		const harness: Harness = createHarness(t);
		const work: ControlledWork = harness.addWork();
		const request: PromptRequest = { ...REQUEST };

		// Act

		const first: Promise<string | undefined> = admit(harness, request);
		request.sessionID = 'changed-session';
		request.messageID = 'changed-message';
		request.text = 'Changed text';
		const second: Promise<string | undefined> = admit(harness, { ...REQUEST });

		const preparation: Preparation = await work.started.promise;
		const delivery: Delivery = await startDelivery(work);
		delivery.deliver({ text: 'Original result' });
		work.finish.resolve();

		// Assert

		assert.deepEqual(preparation.request, REQUEST);
		assert.deepEqual(await Promise.all([first, second]), ['Original result', 'Original result']);
		assert.equal(harness.preparations.length, 1);
	});

	void it('starts fresh work for an identical request after completion', async (t: TestContext): Promise<void> => {
		// Arrange

		const harness: Harness = createHarness(t);
		const firstWork: ControlledWork = harness.addWork();
		const retryWork: ControlledWork = harness.addWork();

		// Act

		const first: Promise<string | undefined> = admit(harness);
		const firstDelivery: Delivery = await startDelivery(firstWork);
		firstDelivery.deliver({ text: 'First result' });
		firstWork.finish.resolve();
		const firstResult: string | undefined = await first;
		await harness.tracked[0].promise;

		const retry: Promise<string | undefined> = admit(harness);
		const retryDelivery: Delivery = await startDelivery(retryWork);
		retryDelivery.deliver({ text: 'Fresh result' });
		retryWork.finish.resolve();

		// Assert

		assert.equal(firstResult, 'First result');
		assert.equal(await retry, 'Fresh result');
		assert.equal(harness.preparations.length, 2);
		assert.equal(harness.tracked.length, 2);
	});

	for (const stage of ['preparation', 'delivery'] as const) {
		void it(`resolves undefined and permits retry when ${stage} produces no result`, async (t: TestContext): Promise<void> => {
			// Arrange

			const harness: Harness = createHarness(t);
			const work: ControlledWork = harness.addWork();
			const retryWork: ControlledWork = harness.addWork();

			// Act

			const result: Promise<string | undefined> = admit(harness);
			if (stage === 'preparation') {
				await work.started.promise;
				work.preparation.resolve(undefined);
			} else {
				await startDelivery(work);
				work.finish.resolve();
			}

			const initialResult: string | undefined = await result;
			await harness.tracked[0].promise;
			const initialDeliveryCount: number = harness.deliveries.length;
			const initialLogCount: number = harness.logs.length;

			const retry: Promise<string | undefined> = admit(harness);
			const delivery: Delivery = await startDelivery(retryWork);
			delivery.deliver({ text: 'Retry result' });
			retryWork.finish.resolve();

			// Assert

			assert.equal(initialResult, undefined);
			assert.equal(initialDeliveryCount, stage === 'preparation' ? 0 : 1);
			assert.equal(initialLogCount, 0);
			assert.equal(await retry, 'Retry result');
			assert.equal(harness.preparations.length, 2);
		});

		void it(`contains ${stage} failures, logs the session, and permits retry`, async (t: TestContext): Promise<void> => {
			// Arrange

			const harness: Harness = createHarness(t);
			const work: ControlledWork = harness.addWork();
			const retryWork: ControlledWork = harness.addWork();
			const failure: Error = new Error('Controlled prompt failure');

			// Act

			const first: Promise<string | undefined> = admit(harness);
			const second: Promise<string | undefined> = admit(harness);
			if (stage === 'preparation') {
				await work.started.promise;
				work.preparation.reject(failure);
			} else {
				await startDelivery(work);
				work.finish.reject(failure);
			}

			const initialResults: (string | undefined)[] = await Promise.all([first, second]);
			await harness.tracked[0].promise;
			const initialLogs: Harness['logs'] = [...harness.logs];

			const retry: Promise<string | undefined> = admit(harness);
			const delivery: Delivery = await startDelivery(retryWork);
			delivery.deliver({ text: 'Recovered' });
			retryWork.finish.resolve();

			// Assert

			assert.deepEqual(initialResults, [undefined, undefined]);
			assert.equal(initialLogs.length, 1);
			const [level, , context]: Parameters<WriteLog> = initialLogs[0];
			assert.equal(level, 'warn');
			assert.ok(context);
			assert.equal(context.sessionID, REQUEST.sessionID);
			assert.ok(JSON.stringify(context.error).includes(failure.message));
			assert.equal(await retry, 'Recovered');
			assert.equal(harness.preparations.length, 2);
		});
	}

	void it('keeps early-delivered work tracked and reserved until delivery finishes', async (t: TestContext): Promise<void> => {
		// Arrange

		const harness: Harness = createHarness(t, false);
		const work: ControlledWork = harness.addWork();
		const retryWork: ControlledWork = harness.addWork();

		// Act

		const first: Promise<string | undefined> = admit(harness);
		const delivery: Delivery = await startDelivery(work);
		delivery.deliver({ text: 'Early result' });

		const firstResult: string | undefined = await first;
		const settledAfterDelivery: boolean = harness.tracked[0].settled;
		const joinedResult: string | undefined = await admit(harness);
		const earlyPreparationCount: number = harness.preparations.length;
		const earlyTrackedCount: number = harness.tracked.length;

		work.finish.resolve();
		await harness.tracked[0].promise;
		const retry: Promise<string | undefined> = admit(harness);
		const retryDelivery: Delivery = await startDelivery(retryWork);
		retryDelivery.deliver({ text: 'Fresh result' });
		retryWork.finish.resolve();

		// Assert

		assert.equal(firstResult, 'Early result');
		assert.equal(settledAfterDelivery, false);
		assert.equal(joinedResult, 'Early result');
		assert.equal(earlyPreparationCount, 1);
		assert.equal(earlyTrackedCount, 1);
		assert.equal(await retry, 'Fresh result');
		assert.equal(harness.tracked.length, 2);
	});

	void it('rejects an already-aborted admission without registering work', async (t: TestContext): Promise<void> => {
		// Arrange

		const harness: Harness = createHarness(t);
		const caller: AbortController = new AbortController();
		const reason: Error = new Error('Caller already cancelled');
		caller.abort(reason);

		// Act

		const result: Promise<string | undefined> = harness.coordinator.admit(REQUEST, caller.signal);

		// Assert

		await assert.rejects(result, (error: unknown): boolean => error === reason);
		assert.equal(harness.preparations.length, 0);
		assert.equal(harness.deliveries.length, 0);
		assert.equal(harness.tracked.length, 0);
	});

	void it('cancels one admission without interrupting another observer', async (t: TestContext): Promise<void> => {
		// Arrange

		const harness: Harness = createHarness(t);
		const work: ControlledWork = harness.addWork();
		const caller: AbortController = new AbortController();

		// Act

		const first: Promise<string | undefined> = harness.coordinator.admit(REQUEST, caller.signal);
		const second: Promise<string | undefined> = admit(harness);
		const delivery: Delivery = await startDelivery(work);

		caller.abort(new Error('First caller cancelled'));
		const cancelledResult: string | undefined = await first;
		const sharedWorkAborted: boolean = delivery.signal.aborted;
		const sharedWorkSettled: boolean = harness.tracked[0].settled;

		delivery.deliver({ text: 'Remaining caller result' });
		work.finish.resolve();

		// Assert

		assert.equal(cancelledResult, undefined);
		assert.equal(sharedWorkAborted, false);
		assert.equal(sharedWorkSettled, false);
		assert.equal(await second, 'Remaining caller result');
		assert.equal(harness.preparations.length, 1);
	});

	for (const cancelWhenUnobserved of [true, false]) {
		void it(`honors cancelWhenUnobserved=${cancelWhenUnobserved} when the last caller leaves`, async (t: TestContext): Promise<void> => {
			// Arrange

			const harness: Harness = createHarness(t, cancelWhenUnobserved);
			const work: ControlledWork = harness.addWork();
			const retryWork: ControlledWork | undefined = cancelWhenUnobserved ? harness.addWork() : undefined;
			const firstCaller: AbortController = new AbortController();
			const lastCaller: AbortController = new AbortController();
			const reason: Error = new Error('Last caller cancelled');

			// Act

			const first: Promise<string | undefined> = harness.coordinator.admit(REQUEST, firstCaller.signal);
			const last: Promise<string | undefined> = harness.coordinator.admit(REQUEST, lastCaller.signal);
			const delivery: Delivery = await startDelivery(work);
			firstCaller.abort();
			const firstResult: string | undefined = await first;
			const abortedAfterFirstCaller: boolean = delivery.signal.aborted;

			lastCaller.abort(reason);
			const lastResult: string | undefined = await last;
			const abortedAfterLastCaller: boolean = delivery.signal.aborted;
			const settledAfterLastCaller: boolean = harness.tracked[0].settled;

			let retryResult: string | undefined;
			if (retryWork !== undefined) {
				const retry: Promise<string | undefined> = admit(harness);
				const retryDelivery: Delivery = await startDelivery(retryWork);
				retryDelivery.deliver({ text: 'Replacement result' });
				retryWork.finish.resolve();
				retryResult = await retry;
			} else {
				const retry: Promise<string | undefined> = admit(harness);
				delivery.deliver({ text: 'Continuing result' });
				retryResult = await retry;
			}
			work.finish.resolve();
			await harness.tracked[0].promise;

			// Assert

			assert.equal(firstResult, undefined);
			assert.equal(abortedAfterFirstCaller, false);
			assert.equal(lastResult, undefined);
			assert.equal(abortedAfterLastCaller, cancelWhenUnobserved);
			assert.equal(settledAfterLastCaller, false);
			if (cancelWhenUnobserved) {
				assert.equal(delivery.signal.reason, reason);
				assert.equal(retryResult, 'Replacement result');
				assert.equal(harness.tracked.length, 2);
			} else {
				assert.equal(retryResult, 'Continuing result');
				assert.equal(harness.preparations.length, 1);
				assert.equal(harness.tracked.length, 1);
			}
		});
	}

	void it('does not let cancelled old work remove the reservation for its replacement', async (t: TestContext): Promise<void> => {
		// Arrange

		const harness: Harness = createHarness(t);
		const oldWork: ControlledWork = harness.addWork();
		const replacementWork: ControlledWork = harness.addWork();
		const caller: AbortController = new AbortController();

		// Act

		const oldAdmission: Promise<string | undefined> = harness.coordinator.admit(REQUEST, caller.signal);
		await startDelivery(oldWork);
		caller.abort();
		const oldResult: string | undefined = await oldAdmission;

		const replacement: Promise<string | undefined> = admit(harness);
		const delivery: Delivery = await startDelivery(replacementWork);
		oldWork.finish.resolve();
		await harness.tracked[0].promise;

		const joining: Promise<string | undefined> = admit(harness);
		delivery.deliver({ text: 'Replacement result' });
		replacementWork.finish.resolve();

		// Assert

		assert.equal(oldResult, undefined);
		assert.deepEqual(await Promise.all([replacement, joining]), ['Replacement result', 'Replacement result']);
		assert.equal(harness.preparations.length, 2);
		assert.equal(harness.tracked.length, 2);
	});

	void it('suppresses a delivered result when the caller aborts before consuming it', async (t: TestContext): Promise<void> => {
		// Arrange

		const harness: Harness = createHarness(t, false);
		const work: ControlledWork = harness.addWork();
		const caller: AbortController = new AbortController();

		// Act

		const result: Promise<string | undefined> = harness.coordinator.admit(REQUEST, caller.signal);
		const delivery: Delivery = await startDelivery(work);

		delivery.deliver({ text: 'Stale result' });
		caller.abort();
		const deliveredResult: string | undefined = await result;
		const sharedWorkAborted: boolean = delivery.signal.aborted;
		work.finish.resolve();

		// Assert

		assert.equal(deliveredResult, undefined);
		assert.equal(sharedWorkAborted, false);
	});

	void it('stops all active tasks, suppresses late results, and refuses new admissions', async (t: TestContext): Promise<void> => {
		// Arrange

		const harness: Harness = createHarness(t, false);
		const initiallyStopped: boolean = harness.coordinator.isStopped();
		const firstWork: ControlledWork = harness.addWork();
		const secondWork: ControlledWork = harness.addWork();

		// Act

		const first: Promise<string | undefined> = admit(harness);
		const second: Promise<string | undefined> = admit(harness, { ...REQUEST, sessionID: 'session-2' });
		const firstDelivery: Delivery = await startDelivery(firstWork);
		const secondDelivery: Delivery = await startDelivery(secondWork);

		harness.coordinator.stop();
		const reason: unknown = firstDelivery.signal.reason;
		harness.coordinator.stop();
		const stopped: boolean = harness.coordinator.isStopped();
		const firstAborted: boolean = firstDelivery.signal.aborted;
		const secondAborted: boolean = secondDelivery.signal.aborted;
		const repeatedStopReason: unknown = firstDelivery.signal.reason;

		firstDelivery.deliver({ text: 'Late first result' });
		secondDelivery.deliver({ text: 'Late second result' });
		firstWork.finish.resolve();
		secondWork.finish.resolve();
		const results: (string | undefined)[] = await Promise.all([first, second]);
		const newResult: string | undefined = await admit(harness, { ...REQUEST, sessionID: 'new-session' });

		// Assert

		assert.equal(initiallyStopped, false);
		assert.equal(stopped, true);
		assert.equal(firstAborted, true);
		assert.equal(secondAborted, true);
		assert.equal(repeatedStopReason, reason);
		assert.deepEqual(results, [undefined, undefined]);
		assert.equal(newResult, undefined);
		assert.equal(harness.preparations.length, 2);
		assert.equal(harness.tracked.length, 2);
	});

	void it('does not deliver when preparation ignores cancellation and returns an executable', async (t: TestContext): Promise<void> => {
		// Arrange

		const harness: Harness = createHarness(t);
		const work: ControlledWork = harness.addWork();
		const caller: AbortController = new AbortController();

		// Act

		const result: Promise<string | undefined> = harness.coordinator.admit(REQUEST, caller.signal);
		const preparation: Preparation = await work.started.promise;

		caller.abort();
		const admissionResult: string | undefined = await result;
		const preparationAborted: boolean = preparation.signal.aborted;
		work.preparation.resolve(work.execute);
		await harness.tracked[0].promise;

		// Assert

		assert.equal(admissionResult, undefined);
		assert.equal(preparationAborted, true);
		assert.equal(harness.deliveries.length, 0);
	});
});
