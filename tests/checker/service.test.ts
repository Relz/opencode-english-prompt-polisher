import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';

import type { SessionGenerate } from '@opencode/plugin/promise/session';
import { Agent } from '@opencode/schema/agent';
import { Model } from '@opencode/schema/model';
import { Provider } from '@opencode/schema/provider';
import { Session } from '@opencode/schema/session';
import {
	buildCheckerPrompt,
	CHECKER_SYSTEM_PROMPT,
	type ChatMessageInput,
	type PolisherResult,
} from 'english-prompt-polisher';

import { createCheckerService, type CheckerContext, type CheckerService } from '../../src/checker/service.ts';
import type { OpenCodeChatModel, OpenCodeOptions } from '../../src/types.ts';

type Generate = CheckerContext['session']['generate'];
type GenerateResult = Awaited<ReturnType<Generate>>;
type CreateRequest = NonNullable<Parameters<CheckerContext['session']['create']>[0]>;
type ControlledGeneration = {
	started: PromiseWithResolvers<Parameters<Generate>>;
	result: PromiseWithResolvers<GenerateResult>;
	run?: Generate;
};
type Harness = {
	service: CheckerService;
	createCalls: CreateRequest[];
	generateCalls: Parameters<Generate>[];
	removeCalls: Parameters<CheckerContext['session']['remove']>[0][];
	tracked: Promise<void>[];
	addGeneration: (run?: Generate) => ControlledGeneration;
	check: (input?: ChatMessageInput, signal?: AbortSignal) => Promise<PolisherResult>;
};

const OPTIONS: OpenCodeOptions = { outputFile: 'unused.md' };
const INPUT: ChatMessageInput = { conversationId: 'ses_source', messageId: 'source-message' };
const SOURCE_LOCATION: { directory: string } = { directory: '/source-project' };
const PROMPT: string = 'Please review this code.';
const RESULT: PolisherResult = {
	needsProposal: true,
	detectedLanguage: 'en',
	reason: 'Improve clarity.',
	proposedPrompt: 'Please review the attached code.',
};
const RESPONSE: GenerateResult = { text: JSON.stringify(RESULT) };

function createHarness(t: TestContext, options: OpenCodeOptions = OPTIONS): Harness {
	const createCalls: Harness['createCalls'] = [];
	const generateCalls: Harness['generateCalls'] = [];
	const removeCalls: Harness['removeCalls'] = [];
	const tracked: Promise<void>[] = [];
	const checks: Promise<PolisherResult>[] = [];
	const generations: ControlledGeneration[] = [];
	const queued: ControlledGeneration[] = [];
	const service: CheckerService = createCheckerService(
		{
			location: { directory: '/plugin-project' },
			session: {
				create: (request): Promise<{ id: string }> => {
					assert.ok(request, 'session creation requires options');
					createCalls.push(request);
					return Promise.resolve({ id: `ses_checker-${createCalls.length}` });
				},
				generate: (...args): Promise<GenerateResult> => {
					generateCalls.push(args);
					const generation: ControlledGeneration | undefined = queued.shift();
					assert.ok(generation, 'unexpected generation: no response was queued');
					generation.started.resolve(args);
					return generation.run?.(...args) ?? generation.result.promise;
				},
				remove: (request): Promise<void> => {
					removeCalls.push(request);
					return Promise.resolve();
				},
			},
		},
		options,
		(promise): void => {
			tracked.push(promise);
		},
	);
	t.after(async (): Promise<void> => {
		for (const generation of generations) {
			generation.result.resolve(RESPONSE);
		}
		await Promise.allSettled(checks);
		await Promise.allSettled(tracked);
	});
	return {
		service,
		createCalls,
		generateCalls,
		removeCalls,
		tracked,
		addGeneration: (run): ControlledGeneration => {
			const generation: ControlledGeneration = {
				started: Promise.withResolvers<Parameters<Generate>>(),
				result: Promise.withResolvers<GenerateResult>(),
				run,
			};
			generations.push(generation);
			queued.push(generation);
			return generation;
		},
		check: (input = INPUT, signal): Promise<PolisherResult> => {
			const check: Promise<PolisherResult> = service.check(SOURCE_LOCATION, input, PROMPT, signal);
			checks.push(check);
			// Observe failures immediately, preserving the original promise for assertions.
			void check.catch((): void => {
				// Teardown also observes this check if a test assertion fails early.
			});
			return check;
		},
	};
}

function createEvent(sessionID: string): SessionGenerate {
	return {
		sessionID: Session.ID.make(sessionID),
		agent: Agent.ID.make('source-agent'),
		model: { providerID: Provider.ID.make('source-provider'), id: Model.ID.make('source-model') },
		system: [{ type: 'text', text: 'Original system instructions' }],
		tools: { read: { description: 'Read a file', input: { type: 'object' } } },
		messages: [],
		options: { temperature: 0.2 },
	};
}

type GenerationSnapshot = { event: SessionGenerate; original: SessionGenerate; expected: SessionGenerate };

function captureGeneration(service: CheckerService, sessionID: string): GenerationSnapshot {
	const event: SessionGenerate = createEvent(sessionID);
	const original: SessionGenerate = { ...event };
	const expected: SessionGenerate = structuredClone(event);
	service.handleGenerate(event);
	return { event, original, expected };
}

function assertRestricted({ event, original, expected }: GenerationSnapshot): void {
	assert.deepEqual(event, { ...expected, system: [{ type: 'text', text: CHECKER_SYSTEM_PROMPT }], tools: {} });
	assert.equal(event.messages, original.messages);
	assert.equal(event.options, original.options);
	assert.equal(event.model, original.model);
}

function assertUntouched({ event, original, expected }: GenerationSnapshot): void {
	assert.deepEqual(event, expected);
	assert.equal(event.system, original.system);
	assert.equal(event.tools, original.tools);
}

void describe('checker service', { timeout: 5000 }, (): void => {
	void it('checks in the source directory using a child session and returns the parsed response', async (t: TestContext): Promise<void> => {
		// Arrange

		const harness: Harness = createHarness(t);
		harness.addGeneration().result.resolve(RESPONSE);

		// Act

		const result: PolisherResult = await harness.check();

		// Assert

		assert.deepEqual(result, RESULT);
		assert.equal(harness.createCalls.length, 1);
		const request: Harness['createCalls'][number] = harness.createCalls[0];
		assert.equal(request.parentID, INPUT.conversationId);
		assert.deepEqual(request.location, SOURCE_LOCATION);
		assert.equal(request.agent, 'general');
		assert.equal(harness.generateCalls.length, 1);
		assert.deepEqual(harness.generateCalls[0][0], {
			sessionID: 'ses_checker-1',
			prompt: buildCheckerPrompt(PROMPT),
		});
	});

	const modelCases: {
		name: string;
		checker?: OpenCodeOptions['checker'];
		inputModel?: OpenCodeChatModel;
		expectedModel: Harness['createCalls'][number]['model'];
	}[] = [
		{ name: 'no model', expectedModel: undefined },
		{
			name: 'an explicit override',
			checker: { agent: 'reviewer', model: { providerID: 'override-provider', modelID: 'override-model' } },
			inputModel: { providerID: 'source-provider', modelID: 'source-model' },
			expectedModel: { providerID: 'override-provider', id: 'override-model' },
		},
		{
			name: 'the current model with a variant',
			checker: { agent: 'reviewer', model: 'current' },
			inputModel: { providerID: 'source-provider', modelID: 'source-model', variant: 'reasoning' },
			expectedModel: { providerID: 'source-provider', id: 'source-model', variant: 'reasoning' },
		},
	];
	for (const { name, checker, inputModel, expectedModel } of modelCases) {
		void it(`maps session configuration for ${name}`, async (t: TestContext): Promise<void> => {
			// Arrange

			const harness: Harness = createHarness(t, { ...OPTIONS, checker });
			harness.addGeneration().result.resolve(RESPONSE);

			// Act

			await harness.check({ ...INPUT, model: inputModel });

			// Assert

			assert.equal(harness.createCalls.length, 1);
			assert.deepEqual(harness.createCalls[0].model, expectedModel);
			if (checker?.agent !== undefined) {
				assert.equal(harness.createCalls[0].agent, checker.agent);
			}
		});
	}

	void it('replaces system instructions and disables tools before generation starts', async (t: TestContext): Promise<void> => {
		// Arrange

		const harness: Harness = createHarness(t);
		const generations: GenerationSnapshot[] = [];
		harness.addGeneration((request): Promise<GenerateResult> => {
			generations.push(captureGeneration(harness.service, request.sessionID));
			return Promise.resolve(RESPONSE);
		});

		// Act

		const result: PolisherResult = await harness.check();

		// Assert

		assert.deepEqual(result, RESULT);
		assert.equal(generations.length, 1);
		assertRestricted(generations[0]);
	});

	void it('leaves unrelated generation events untouched while a check is active', async (t: TestContext): Promise<void> => {
		// Arrange

		const harness: Harness = createHarness(t);
		const generation: ControlledGeneration = harness.addGeneration();

		// Act

		const check: Promise<PolisherResult> = harness.check();
		await generation.started.promise;

		const unrelated: GenerationSnapshot = captureGeneration(harness.service, INPUT.conversationId);

		generation.result.resolve(RESPONSE);
		await check;

		// Assert

		assertUntouched(unrelated);
	});

	for (const outcome of ['success', 'rejected promise', 'synchronous throw'] as const) {
		void it(`stops restricting a session after generation ${outcome}`, async (t: TestContext): Promise<void> => {
			// Arrange

			const failure: Error = new Error('Generation failed');
			const harness: Harness = createHarness(t);
			harness.addGeneration((): Promise<GenerateResult> => {
				if (outcome === 'synchronous throw') {
					throw failure;
				}
				return outcome === 'success' ? Promise.resolve(RESPONSE) : Promise.reject(failure);
			});

			// Act

			const check: Promise<PolisherResult> = harness.check();
			const settled: PromiseSettledResult<PolisherResult>[] = await Promise.allSettled([check]);
			const generation: GenerationSnapshot = captureGeneration(harness.service, 'ses_checker-1');

			// Assert

			assert.equal(settled[0].status, outcome === 'success' ? 'fulfilled' : 'rejected');
			if (outcome === 'success') {
				assert.deepEqual(await check, RESULT);
			} else {
				await assert.rejects(check, (error: unknown): boolean => error === failure);
			}
			assertUntouched(generation);
		});
	}

	void it('keeps concurrent checks and their active-session lifetimes independent', async (t: TestContext): Promise<void> => {
		// Arrange

		const harness: Harness = createHarness(t);
		const firstGeneration: ControlledGeneration = harness.addGeneration();
		const secondGeneration: ControlledGeneration = harness.addGeneration();
		const secondResult: PolisherResult = { ...RESULT, proposedPrompt: 'Please explain this function.' };

		// Act

		const first: Promise<PolisherResult> = harness.check();
		const second: Promise<PolisherResult> = harness.check({ ...INPUT, conversationId: 'ses_another-source' });
		const [[firstRequest], [secondRequest]]: Parameters<Generate>[] = await Promise.all([
			firstGeneration.started.promise,
			secondGeneration.started.promise,
		]);
		const firstActive: GenerationSnapshot = captureGeneration(harness.service, firstRequest.sessionID);
		const secondActive: GenerationSnapshot = captureGeneration(harness.service, secondRequest.sessionID);

		firstGeneration.result.resolve(RESPONSE);
		const firstResult: PolisherResult = await first;
		const firstFinished: GenerationSnapshot = captureGeneration(harness.service, firstRequest.sessionID);
		const secondStillActive: GenerationSnapshot = captureGeneration(harness.service, secondRequest.sessionID);

		secondGeneration.result.resolve({ text: JSON.stringify(secondResult) });
		const actualSecondResult: PolisherResult = await second;
		const secondFinished: GenerationSnapshot = captureGeneration(harness.service, secondRequest.sessionID);

		// Assert

		assert.notEqual(firstRequest.sessionID, secondRequest.sessionID);
		assertRestricted(firstActive);
		assertRestricted(secondActive);
		assert.deepEqual(firstResult, RESULT);
		assertUntouched(firstFinished);
		assertRestricted(secondStillActive);
		assert.deepEqual(actualSecondResult, secondResult);
		assertUntouched(secondFinished);
	});

	void it('rejects an invalid checker response rather than fabricating a result', async (t: TestContext): Promise<void> => {
		// Arrange

		const harness: Harness = createHarness(t);
		harness.addGeneration().result.resolve({ text: 'This is not a checker result.' });

		// Act

		const check: Promise<PolisherResult> = harness.check();
		await Promise.allSettled([check]);
		const generation: GenerationSnapshot = captureGeneration(harness.service, 'ses_checker-1');

		// Assert

		await assert.rejects(check);
		assertUntouched(generation);
	});

	void it('forwards cancellation to generation and clears the active session on rejection', async (t: TestContext): Promise<void> => {
		// Arrange

		const harness: Harness = createHarness(t);
		const signals: (AbortSignal | undefined)[] = [];
		const generation: ControlledGeneration = harness.addGeneration((_request, options): Promise<GenerateResult> => {
			signals.push(options?.signal);
			controller.signal.addEventListener(
				'abort',
				(): void => {
					generation.result.reject(reason);
				},
				{ once: true },
			);
			return generation.result.promise;
		});
		const controller: AbortController = new AbortController();
		const reason: Error = new Error('Check cancelled');

		// Act

		const check: Promise<PolisherResult> = harness.check(INPUT, controller.signal);
		const [request]: Parameters<Generate> = await generation.started.promise;
		const active: GenerationSnapshot = captureGeneration(harness.service, request.sessionID);

		controller.abort(reason);
		await Promise.allSettled([check]);
		const finished: GenerationSnapshot = captureGeneration(harness.service, request.sessionID);

		// Assert

		assert.deepEqual(signals, [controller.signal]);
		assertRestricted(active);
		await assert.rejects(check, (error: unknown): boolean => error === reason);
		assertUntouched(finished);
	});

	for (const deleteSession of [undefined, false]) {
		void it(
			deleteSession === false
				? 'retains the session without tracking removal'
				: 'removes the session and registers pending work by default',
			async (t: TestContext): Promise<void> => {
				// Arrange

				const harness: Harness = createHarness(
					t,
					deleteSession === false ? { ...OPTIONS, checker: { deleteSession } } : OPTIONS,
				);
				harness.addGeneration().result.resolve(RESPONSE);

				// Act

				const result: PolisherResult = await harness.check();
				const generation: GenerationSnapshot = captureGeneration(harness.service, 'ses_checker-1');
				await Promise.all(harness.tracked);

				// Assert

				assert.deepEqual(result, RESULT);
				assertUntouched(generation);
				if (deleteSession === false) {
					assert.deepEqual(harness.removeCalls, []);
					assert.deepEqual(harness.tracked, []);
				} else {
					assert.equal(harness.tracked.length, 1);
					assert.deepEqual(harness.removeCalls, [{ sessionID: 'ses_checker-1' }]);
				}
			},
		);
	}
});
