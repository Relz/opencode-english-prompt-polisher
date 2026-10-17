import assert from 'node:assert/strict';
import { after, describe, it, mock } from 'node:test';

import { Location } from '@opencode/schema/location';
import { Session } from '@opencode/schema/session';
import type { ChatMessageInput, PolisherResult, WriteLog } from 'english-prompt-polisher';

import type { CheckerService } from '../src/checker/index.ts';
import type { CheckerModelResolver } from '../src/checker/model-resolver.ts';
import type { PromptProcessor } from '../src/prompt-processor.ts';
import type { createPromptRunners, OpenCodePromptRunners, RunCheckPrompt } from '../src/prompt-runners.ts';
import type { PreparedPrompt, PromptHandlingResult, PromptRequest } from '../src/prompt-task.ts';
import type { OpenCodeContext } from '../src/server-context.ts';
import type { OpenCodeChatModel, OpenCodeOptions } from '../src/types.ts';

type SessionLookup = OpenCodeContext['session']['get'];
type SessionSnapshot = Awaited<ReturnType<SessionLookup>>;
type RunnerFactory = typeof createPromptRunners;
type HarnessConfig = Partial<OpenCodePromptRunners> & {
	get?: SessionLookup;
	resolveModel?: CheckerModelResolver;
	check?: CheckerService['check'];
};
type Harness = {
	processor: PromptProcessor;
	options: OpenCodeOptions;
	writeLog: WriteLog;
	controller: AbortController;
	lookups: Parameters<SessionLookup>[];
	resolutions: Parameters<CheckerModelResolver>[];
	checks: Parameters<CheckerService['check']>[];
	factories: Parameters<RunnerFactory>[];
	rewrites: Parameters<OpenCodePromptRunners['rewrite']>[];
	proposals: Parameters<OpenCodePromptRunners['propose']>[];
};

const REQUEST: PromptRequest = {
	sessionID: 'session-1',
	messageID: 'message-1',
	text: 'Please review this code.',
};
const SESSION: SessionSnapshot = {
	id: Session.ID.make(REQUEST.sessionID),
	parentID: undefined,
	model: undefined,
	location: { directory: Location.Ref.fields.directory.make('/source-project') },
};
const MODEL: OpenCodeChatModel = { providerID: 'provider-1', modelID: 'model-1', variant: 'reasoning' };
const RESULT: PolisherResult = {
	needsProposal: true,
	detectedLanguage: 'en',
	reason: 'Improve clarity.',
	proposedPrompt: 'Please review the attached code.',
};

// Route each processor's runner factory by its options identity so tests share no mutable fake behavior.
const runnerFactories: WeakMap<OpenCodeOptions, RunnerFactory> = new WeakMap();
const runnerModule: ReturnType<typeof mock.module> = mock.module('../src/prompt-runners.ts', {
	exports: {
		createPromptRunners: (...args: Parameters<RunnerFactory>): OpenCodePromptRunners => {
			const factory: RunnerFactory | undefined = runnerFactories.get(args[0]);
			assert.ok(factory, 'runner factory must belong to a test harness');
			return factory(...args);
		},
	},
});
// The processor must be imported after its runner dependency is mocked.
const { createPromptProcessor } = await import('../src/prompt-processor.ts');
after((): void => {
	runnerModule.restore();
});

function unexpectedCall(): never {
	assert.fail('unexpected context operation');
}

function createHarness(
	config: HarnessConfig = {},
	options: OpenCodeOptions = { outputFile: 'unused.md', mode: 'rewrite' },
): Harness {
	const lookups: Harness['lookups'] = [];
	const resolutions: Harness['resolutions'] = [];
	const checks: Harness['checks'] = [];
	const factories: Harness['factories'] = [];
	const rewrites: Harness['rewrites'] = [];
	const proposals: Harness['proposals'] = [];
	const processorOptions: OpenCodeOptions = { ...options };
	const writeLog: WriteLog = (): Promise<void> => Promise.resolve();
	runnerFactories.set(processorOptions, (...args): OpenCodePromptRunners => {
		factories.push(args);
		return {
			rewrite: (...rewriteArgs): Promise<string | undefined> => {
				rewrites.push(rewriteArgs);
				return config.rewrite?.(...rewriteArgs) ?? Promise.resolve(undefined);
			},
			propose: (...proposalArgs): Promise<void> => {
				proposals.push(proposalArgs);
				return config.propose?.(...proposalArgs) ?? Promise.resolve();
			},
		};
	});
	const ctx: OpenCodeContext = {
		options: {},
		location: { directory: '/plugin-project' },
		session: {
			get: (...args): Promise<SessionSnapshot> => {
				lookups.push(args);
				return config.get?.(...args) ?? Promise.resolve(SESSION);
			},
			create: unexpectedCall,
			generate: unexpectedCall,
			remove: unexpectedCall,
			hook: unexpectedCall,
		},
		model: { default: unexpectedCall },
	};
	return {
		processor: createPromptProcessor(
			ctx,
			processorOptions,
			(...args): Promise<PolisherResult> => {
				checks.push(args);
				return config.check?.(...args) ?? Promise.resolve(RESULT);
			},
			writeLog,
			(...args): ReturnType<CheckerModelResolver> => {
				resolutions.push(args);
				return config.resolveModel?.(...args) ?? Promise.resolve(MODEL);
			},
		),
		options: processorOptions,
		writeLog,
		controller: new AbortController(),
		lookups,
		resolutions,
		checks,
		factories,
		rewrites,
		proposals,
	};
}

async function prepare(harness: Harness, request: PromptRequest = REQUEST): Promise<PreparedPrompt> {
	const execute: PreparedPrompt | undefined = await harness.processor.prepare(request, harness.controller.signal);
	assert.ok(execute, 'root session must produce an executable');
	return execute;
}

function checkerCallback(harness: Harness): RunCheckPrompt {
	assert.equal(harness.factories.length, 1);
	return harness.factories[0][1];
}

void describe('prompt processor', { timeout: 5000 }, (): void => {
	void it('prepares a root session without starting model resolution or runners', async (): Promise<void> => {
		// Arrange

		const harness: Harness = createHarness();

		// Act

		await prepare(harness);

		// Assert

		assert.equal(harness.lookups.length, 1);
		const [request, options]: Parameters<SessionLookup> = harness.lookups[0];
		assert.deepEqual(request, { sessionID: REQUEST.sessionID });
		assert.equal(options?.signal, harness.controller.signal);
		assert.equal(harness.resolutions.length, 0);
		assert.equal(harness.factories.length, 0);
		assert.equal(harness.checks.length, 0);
	});

	void it('skips child sessions before model resolution or runner creation', async (): Promise<void> => {
		// Arrange

		const harness: Harness = createHarness({
			get: (): Promise<SessionSnapshot> =>
				Promise.resolve({ ...SESSION, parentID: Session.ID.make('session-parent') }),
		});

		// Act

		const execute: PreparedPrompt | undefined = await harness.processor.prepare(REQUEST, harness.controller.signal);

		// Assert

		assert.equal(execute, undefined);
		assert.equal(harness.resolutions.length, 0);
		assert.equal(harness.factories.length, 0);
	});

	void it('snapshots request identity and text before lookup and keeps them after preparation', async (): Promise<void> => {
		// Arrange

		const lookup: PromiseWithResolvers<SessionSnapshot> = Promise.withResolvers();
		const harness: Harness = createHarness({ get: (): Promise<SessionSnapshot> => lookup.promise });
		const request: PromptRequest = { ...REQUEST };

		// Act

		const preparation: Promise<PreparedPrompt> = prepare(harness, request);
		Object.assign(request, { sessionID: 'changed-session', messageID: 'changed-message', text: 'Changed text' });
		lookup.resolve(SESSION);
		const execute: PreparedPrompt = await preparation;
		Object.assign(request, { sessionID: 'later-session', messageID: 'later-message', text: 'Later text' });

		await execute();

		// Assert

		assert.deepEqual(harness.lookups[0][0], { sessionID: REQUEST.sessionID });
		const [input, coreInput, text]: Harness['rewrites'][number] = harness.rewrites[0];
		assert.equal(input.sessionID, REQUEST.sessionID);
		assert.equal(input.messageID, REQUEST.messageID);
		assert.equal(coreInput.conversationId, REQUEST.sessionID);
		assert.equal(coreInput.messageId, REQUEST.messageID);
		assert.equal(text, REQUEST.text);
	});

	void it('wires session, model, options, logger, and checker arguments through without changing the checker result', async (): Promise<void> => {
		// Arrange

		const harness: Harness = createHarness();
		const execute: PreparedPrompt = await prepare(harness);
		// Use distinct values to verify the wrapper forwards the runner's arguments, not captured request values.
		const checkerInput: ChatMessageInput = { conversationId: 'runner-session', messageId: 'runner-message' };

		// Act

		await execute();
		const runCheck: RunCheckPrompt = checkerCallback(harness);
		const result: PolisherResult = await runCheck(checkerInput, 'Runner prompt');

		// Assert

		assert.equal(harness.resolutions.length, 1);
		assert.equal(harness.resolutions[0][0], SESSION);
		assert.equal(harness.resolutions[0][1], harness.controller.signal);
		const [options, , writeLog, signal]: Parameters<RunnerFactory> = harness.factories[0];
		assert.equal(options, harness.options);
		assert.equal(writeLog, harness.writeLog);
		assert.equal(signal, harness.controller.signal);
		assert.equal(harness.rewrites.length, 1);
		const [input, coreInput]: Harness['rewrites'][number] = harness.rewrites[0];
		assert.deepEqual(input, { sessionID: REQUEST.sessionID, messageID: REQUEST.messageID, model: MODEL });
		assert.deepEqual(coreInput, { conversationId: REQUEST.sessionID, messageId: REQUEST.messageID, model: MODEL });
		assert.equal(harness.proposals.length, 0);

		assert.equal(result, RESULT);
		assert.equal(harness.checks.length, 1);
		const [location, checkedInput, prompt, checkerSignal]: Harness['checks'][number] = harness.checks[0];
		assert.equal(location, SESSION.location);
		assert.equal(checkedInput, checkerInput);
		assert.equal(prompt, 'Runner prompt');
		assert.equal(checkerSignal, harness.controller.signal);
	});

	void it('runs without a message ID or resolved model without inventing either', async (): Promise<void> => {
		// Arrange

		const harness: Harness = createHarness({
			resolveModel: (): ReturnType<CheckerModelResolver> => Promise.resolve(undefined),
		});
		const execute: PreparedPrompt = await prepare(harness, { sessionID: REQUEST.sessionID, text: REQUEST.text });

		// Act

		const result: PromptHandlingResult = await execute();

		// Assert

		assert.equal(result.text, undefined);
		const [input, coreInput]: Harness['rewrites'][number] = harness.rewrites[0];
		assert.equal(input.messageID, undefined);
		assert.equal(input.model, undefined);
		assert.deepEqual(coreInput, { conversationId: REQUEST.sessionID });
	});

	for (const mode of ['proposal', undefined] as const) {
		void it(`uses proposal mode ${mode === undefined ? 'by default' : 'when explicitly selected'} and preserves raw text`, async (): Promise<void> => {
			// Arrange

			const harness: Harness = createHarness(
				{},
				{ outputFile: 'unused.md', ...(mode === undefined ? {} : { mode }) },
			);
			const text: string = ` \n${REQUEST.text}\t `;
			const execute: PreparedPrompt = await prepare(harness, { ...REQUEST, text });

			// Act

			const result: PromptHandlingResult = await execute();

			// Assert

			assert.deepEqual(result, {});
			assert.equal(harness.rewrites.length, 0);
			assert.equal(harness.proposals.length, 1);
			assert.deepEqual(harness.proposals[0][2], { parts: [{ type: 'text', text }] });
		});
	}

	void it('waits for proposal completion and propagates its failure', async (): Promise<void> => {
		// Arrange

		const started: PromiseWithResolvers<void> = Promise.withResolvers();
		const finish: PromiseWithResolvers<void> = Promise.withResolvers();
		const harness: Harness = createHarness(
			{
				propose: (): Promise<void> => {
					started.resolve();
					return finish.promise;
				},
			},
			{ outputFile: 'unused.md', mode: 'proposal' },
		);
		const execute: PreparedPrompt = await prepare(harness);
		const failure: Error = new Error('Proposal failed');

		// Act

		const execution: Promise<PromptHandlingResult> = execute();
		const settled: Promise<PromiseSettledResult<PromptHandlingResult>[]> = Promise.allSettled([execution]);
		await started.promise;
		finish.reject(failure);

		// Assert

		await settled;
		await assert.rejects(execution, (error: unknown): boolean => error === failure);
	});

	const rewrites: { name: string; original: string; result: string | undefined; expected: string | undefined }[] = [
		{ name: 'trims input and replacement', original: '  original  ', result: '  improved  ', expected: 'improved' },
		{
			name: 'suppresses a normalized replacement identical to the original',
			original: 'original',
			result: '  original  ',
			expected: undefined,
		},
		{
			name: 'compares against the untrimmed original',
			original: '  original  ',
			result: 'original',
			expected: 'original',
		},
		{
			name: 'preserves the absence of a replacement',
			original: 'original',
			result: undefined,
			expected: undefined,
		},
	];
	for (const { name, original, result, expected } of rewrites) {
		void it(`rewrite ${name}`, async (): Promise<void> => {
			// Arrange

			const harness: Harness = createHarness({
				rewrite: (): Promise<string | undefined> => Promise.resolve(result),
			});
			const execute: PreparedPrompt = await prepare(harness, { ...REQUEST, text: original });

			// Act

			const actual: PromptHandlingResult = await execute();

			// Assert

			assert.equal(actual.text, expected);
			assert.equal(harness.rewrites.length, 1);
			assert.equal(harness.rewrites[0][2], original.trim());
			assert.equal(harness.proposals.length, 0);
		});
	}

	void it('rejects pre-aborted preparation without looking up the session', async (): Promise<void> => {
		// Arrange

		const harness: Harness = createHarness();
		const reason: Error = new Error('Preparation cancelled');
		harness.controller.abort(reason);

		// Act

		const preparation: Promise<PreparedPrompt | undefined> = harness.processor.prepare(
			REQUEST,
			harness.controller.signal,
		);

		// Assert

		await assert.rejects(preparation, (error: unknown): boolean => error === reason);
		assert.equal(harness.lookups.length, 0);
		assert.equal(harness.resolutions.length, 0);
		assert.equal(harness.factories.length, 0);
	});

	void it('rejects a successful lookup delivered after cancellation', async (): Promise<void> => {
		// Arrange

		const lookup: PromiseWithResolvers<SessionSnapshot> = Promise.withResolvers();
		const harness: Harness = createHarness({ get: (): Promise<SessionSnapshot> => lookup.promise });
		const reason: Error = new Error('Lookup cancelled');

		// Act

		const preparation: Promise<PreparedPrompt | undefined> = harness.processor.prepare(
			REQUEST,
			harness.controller.signal,
		);
		const settled: Promise<PromiseSettledResult<PreparedPrompt | undefined>[]> = Promise.allSettled([preparation]);

		lookup.resolve(SESSION);
		harness.controller.abort(reason);

		// Assert

		await settled;
		await assert.rejects(preparation, (error: unknown): boolean => error === reason);
		assert.equal(harness.resolutions.length, 0);
		assert.equal(harness.factories.length, 0);
	});

	void it('rejects execution cancelled after preparation without resolving a model', async (): Promise<void> => {
		// Arrange

		const harness: Harness = createHarness();
		const execute: PreparedPrompt = await prepare(harness);
		const reason: Error = new Error('Execution cancelled');
		harness.controller.abort(reason);

		// Act

		const execution: Promise<PromptHandlingResult> = execute();

		// Assert

		await assert.rejects(execution, (error: unknown): boolean => error === reason);
		assert.equal(harness.resolutions.length, 0);
		assert.equal(harness.factories.length, 0);
	});

	void it('rejects a resolved model delivered after cancellation without starting runners', async (): Promise<void> => {
		// Arrange

		const started: PromiseWithResolvers<void> = Promise.withResolvers();
		const model: PromiseWithResolvers<OpenCodeChatModel | undefined> = Promise.withResolvers();
		const harness: Harness = createHarness({
			resolveModel: (): ReturnType<CheckerModelResolver> => {
				started.resolve();
				return model.promise;
			},
		});
		const execute: PreparedPrompt = await prepare(harness);
		const reason: Error = new Error('Model resolution cancelled');

		// Act

		const execution: Promise<PromptHandlingResult> = execute();
		const settled: Promise<PromiseSettledResult<PromptHandlingResult>[]> = Promise.allSettled([execution]);
		await started.promise;

		model.resolve(MODEL);
		harness.controller.abort(reason);

		// Assert

		await settled;
		await assert.rejects(execution, (error: unknown): boolean => error === reason);
		assert.equal(harness.factories.length, 0);
	});

	void it('rejects the checker callback when cancellation races with a completed check', async (): Promise<void> => {
		// Arrange

		const check: PromiseWithResolvers<PolisherResult> = Promise.withResolvers();
		const harness: Harness = createHarness({ check: (): Promise<PolisherResult> => check.promise });
		const execute: PreparedPrompt = await prepare(harness);
		await execute();
		const reason: Error = new Error('Checker cancelled');

		// Act

		const checking: Promise<PolisherResult> = checkerCallback(harness)(
			{ conversationId: REQUEST.sessionID },
			REQUEST.text,
		);
		const settled: Promise<PromiseSettledResult<PolisherResult>[]> = Promise.allSettled([checking]);

		check.resolve(RESULT);
		harness.controller.abort(reason);

		// Assert

		await settled;
		await assert.rejects(checking, (error: unknown): boolean => error === reason);
	});

	for (const stage of ['lookup', 'model', 'checker'] as const) {
		void it(`preserves ${stage} failures without continuing processing`, async (): Promise<void> => {
			// Arrange

			const failure: Error = new Error(`${stage} failed`);
			const harness: Harness = createHarness({
				...(stage === 'lookup' ? { get: (): Promise<SessionSnapshot> => Promise.reject(failure) } : {}),
				...(stage === 'model'
					? { resolveModel: (): ReturnType<CheckerModelResolver> => Promise.reject(failure) }
					: {}),
				...(stage === 'checker' ? { check: (): Promise<PolisherResult> => Promise.reject(failure) } : {}),
			});
			// Act

			let operation: Promise<unknown>;
			if (stage === 'lookup') {
				operation = harness.processor.prepare(REQUEST, harness.controller.signal);
			} else {
				const execute: PreparedPrompt = await prepare(harness);
				if (stage === 'model') {
					operation = execute();
				} else {
					await execute();
					operation = checkerCallback(harness)({ conversationId: REQUEST.sessionID }, REQUEST.text);
				}
			}

			// Assert

			await assert.rejects(operation, (error: unknown): boolean => error === failure);
			if (stage === 'lookup') {
				assert.equal(harness.resolutions.length, 0);
			}
			if (stage !== 'checker') {
				assert.equal(harness.factories.length, 0);
				assert.equal(harness.checks.length, 0);
			}
		});
	}
});
