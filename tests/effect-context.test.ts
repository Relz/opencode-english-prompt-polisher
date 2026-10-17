import assert from 'node:assert/strict';
import { describe, it, type Mock, type TestContext } from 'node:test';

import { Agent, Location, Model, Provider } from '@opencode/plugin/effect';
import type { Registration } from '@opencode/plugin/effect/registration';
import type { SessionGenerate } from '@opencode/plugin/effect/session';
import { Session } from '@opencode/schema/session';
import { Effect, Exit, Schema, Scope } from 'effect';

import { createEffectContext, type EffectContext } from '../src/effect-context.ts';
import type { OpenCodeContext } from '../src/server-context.ts';

type Overrides = {
	model?: Partial<EffectContext['model']>;
	session?: Partial<EffectContext['session']>;
};
type Harness = {
	context: OpenCodeContext;
	close: () => Promise<void>;
};
type CreateInput = Parameters<OpenCodeContext['session']['create']>[0];
type HookCallback = (event: SessionGenerate, signal: AbortSignal) => Promise<void> | void;
type HookHarness = Harness & {
	hook: Mock<EffectContext['session']['hook']>;
	event: SessionGenerate;
};

const LOCATION: Location.PublicRef = Schema.decodeUnknownSync(Location.PublicRef)({ directory: '/project' });
const SESSION: Session.Info = Schema.decodeUnknownSync(Session.Info)({
	id: 'ses_example',
	parentID: 'ses_parent',
	projectID: 'project-example',
	model: { providerID: 'provider-example', id: 'model-example' },
	cost: 0,
	tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
	time: { created: 0, updated: 0 },
	location: LOCATION,
});
const OPTIONS: EffectContext['options'] = { enabled: true };

async function createHarness(t: TestContext, overrides: Overrides = {}): Promise<Harness> {
	const unexpected = (): never => assert.fail('unexpected underlying operation');
	const source: EffectContext = {
		options: OPTIONS,
		location: LOCATION,
		model: { default: unexpected, ...overrides.model },
		session: {
			get: unexpected,
			create: unexpected,
			generate: unexpected,
			remove: unexpected,
			hook: unexpected,
			...overrides.session,
		},
	};
	const scope: Scope.Closeable = Effect.runSync(Scope.make());
	const close = (): Promise<void> => Effect.runPromise(Scope.close(scope, Exit.void));
	t.after(close);
	return { context: await Effect.runPromise(Scope.provide(createEffectContext(source), scope)), close };
}

async function createHookHarness(t: TestContext, dispose: Effect.Effect<void> = Effect.void): Promise<HookHarness> {
	const hook: Mock<EffectContext['session']['hook']> = t.mock.fn<EffectContext['session']['hook']>(() =>
		Effect.succeed({ dispose }),
	);
	const harness: Harness = await createHarness(t, { session: { hook } });
	const event: SessionGenerate = {
		sessionID: SESSION.id,
		agent: Agent.ID.make('reviewer'),
		model: { providerID: Provider.ID.make('provider-example'), id: Model.ID.make('model-example') },
		system: [],
		messages: [],
		tools: {},
		options: {},
	};
	return { ...harness, hook, event };
}

function hookCallbackEffect(harness: HookHarness): Effect.Effect<void> {
	assert.equal(harness.hook.mock.callCount(), 1, 'hook must be registered before invoking its callback');
	return harness.hook.mock.calls[0].arguments[1](harness.event);
}

void describe('Effect context', { timeout: 5000 }, (): void => {
	void it('exposes plugin settings and adapts session reads', async (t: TestContext): Promise<void> => {
		// Arrange

		const calls: unknown[] = [];
		const { context }: Harness = await createHarness(t, {
			session: {
				get: (input) =>
					Effect.sync(() => {
						calls.push(input);
						return SESSION;
					}),
			},
		});

		// Act

		const session: Awaited<ReturnType<OpenCodeContext['session']['get']>> = await context.session.get({
			sessionID: SESSION.id,
		});

		// Assert

		assert.deepEqual(context.options, OPTIONS);
		assert.deepEqual(context.location, LOCATION);
		assert.deepEqual(session, SESSION);
		assert.deepEqual(calls, [{ sessionID: SESSION.id }]);
	});

	void it('preserves the generation prompt and returns generated text', async (t: TestContext): Promise<void> => {
		// Arrange

		const calls: unknown[] = [];
		const { context }: Harness = await createHarness(t, {
			session: {
				generate: (input) =>
					Effect.sync(() => {
						calls.push(input);
						return { text: 'Polished prompt' };
					}),
			},
		});
		const input: Parameters<OpenCodeContext['session']['generate']>[0] = {
			sessionID: SESSION.id,
			prompt: 'Polish this prompt',
		};

		// Act

		const result: Awaited<ReturnType<OpenCodeContext['session']['generate']>> =
			await context.session.generate(input);

		// Assert

		assert.deepEqual(result, { text: 'Polished prompt' });
		assert.deepEqual(calls, [input]);
	});

	void it('runs session removal for the requested session', async (t: TestContext): Promise<void> => {
		// Arrange

		const calls: unknown[] = [];
		const { context }: Harness = await createHarness(t, {
			session: {
				remove: (input) =>
					Effect.sync(() => {
						calls.push(input);
					}),
			},
		});

		// Act

		await context.session.remove({ sessionID: SESSION.id });

		// Assert

		assert.deepEqual(calls, [{ sessionID: SESSION.id }]);
	});

	for (const selected of [true, false]) {
		void it(`normalizes ${selected ? 'a selected' : 'a missing'} default model`, async (t: TestContext): Promise<void> => {
			// Arrange

			const calls: unknown[] = [];
			const model: Model.Info = Model.Info.default(
				Provider.ID.make('provider-example'),
				Model.ID.make('model-example'),
			);
			const { context }: Harness = await createHarness(t, {
				model: {
					default: (input) =>
						Effect.sync(() => {
							calls.push(input);
							return { location: LOCATION, data: selected ? model : undefined };
						}),
				},
			});
			const input: Parameters<OpenCodeContext['model']['default']>[0] = {
				location: { directory: '/source-project' },
			};

			// Act

			const result: Awaited<ReturnType<OpenCodeContext['model']['default']>> = await context.model.default(input);

			// Assert

			assert.deepEqual(result, {
				data: selected ? { id: model.id, providerID: model.providerID } : null,
			});
			assert.deepEqual(calls, [input]);
		});
	}

	const createCases: { name: string; input: CreateInput; expected: unknown }[] = [
		{
			name: 'populated session options',
			input: {
				title: 'Review',
				parentID: 'ses_parent',
				agent: 'reviewer',
				model: { providerID: 'provider-example', id: 'model-example', variant: 'careful' },
				location: { directory: '/source-project' },
			},
			expected: {
				title: 'Review',
				parentID: 'ses_parent',
				agent: 'reviewer',
				model: { providerID: 'provider-example', id: 'model-example', variant: 'careful' },
				location: { directory: '/source-project' },
			},
		},
		{
			name: 'omitted session options',
			input: undefined,
			expected: {
				title: undefined,
				parentID: undefined,
				agent: undefined,
				model: undefined,
				location: undefined,
			},
		},
		{
			name: 'nullish options without losing an empty title',
			input: { title: '', parentID: null, agent: null, model: null, location: null },
			expected: { title: '', parentID: undefined, agent: undefined, model: undefined, location: undefined },
		},
	];
	for (const { name, input, expected } of createCases) {
		void it(`converts ${name}`, async (t: TestContext): Promise<void> => {
			// Arrange

			const calls: Parameters<EffectContext['session']['create']>[0][] = [];
			const { context }: Harness = await createHarness(t, {
				session: {
					create: (request) =>
						Effect.sync(() => {
							calls.push(request);
							return SESSION;
						}),
				},
			});

			// Act

			const session: Awaited<ReturnType<OpenCodeContext['session']['create']>> =
				await context.session.create(input);

			// Assert

			assert.deepEqual(session, SESSION);
			assert.equal(calls.length, 1);
			const request: (typeof calls)[number] = calls[0];
			assert.deepEqual(
				{
					title: request?.title,
					parentID: request?.parentID,
					agent: request?.agent,
					model: request?.model,
					location: request?.location,
				},
				expected,
			);
		});
	}

	for (const field of ['model', 'location']) {
		void it(`rejects malformed ${field} before calling session.create`, async (t: TestContext): Promise<void> => {
			// Arrange

			let called: boolean = false;
			const { context }: Harness = await createHarness(t, {
				session: {
					create: () => {
						called = true;
						return Effect.succeed(SESSION);
					},
				},
			});

			const createMalformedSession = async (): Promise<void> => {
				// Exercise malformed JavaScript input without weakening the typed fake.
				const result: unknown = Reflect.apply(context.session.create, undefined, [{ [field]: {} }]);
				await result;
			};

			// Act

			const result: Promise<void> = createMalformedSession();

			// Assert

			await assert.rejects(result);
			assert.equal(called, false);
		});
	}

	const cancellableOperations: {
		name: string;
		stub: (effect: Effect.Effect<never>) => Overrides;
		invoke: (context: OpenCodeContext, signal: AbortSignal) => Promise<unknown>;
	}[] = [
		{
			name: 'model.default',
			stub: (effect) => ({ model: { default: () => effect } }),
			invoke: (ctx, signal) => ctx.model.default(undefined, { signal }),
		},
		{
			name: 'session.get',
			stub: (effect) => ({ session: { get: () => effect } }),
			invoke: (ctx, signal) => ctx.session.get({ sessionID: SESSION.id }, { signal }),
		},
		{
			name: 'session.create',
			stub: (effect) => ({ session: { create: () => effect } }),
			invoke: (ctx, signal) => ctx.session.create({ title: 'Review' }, { signal }),
		},
		{
			name: 'session.generate',
			stub: (effect) => ({ session: { generate: () => effect } }),
			invoke: (ctx, signal) => ctx.session.generate({ sessionID: SESSION.id, prompt: 'Review' }, { signal }),
		},
		{
			name: 'session.remove',
			stub: (effect) => ({ session: { remove: () => effect } }),
			invoke: (ctx, signal) => ctx.session.remove({ sessionID: SESSION.id }, { signal }),
		},
	];
	for (const { name, stub, invoke } of cancellableOperations) {
		void it(`does not execute ${name} for a pre-aborted request`, async (t: TestContext): Promise<void> => {
			// Arrange

			let executed: boolean = false;
			const effect: Effect.Effect<never> = Effect.sync((): never => {
				executed = true;
				assert.fail('cancelled operation executed');
			});
			const { context }: Harness = await createHarness(t, stub(effect));
			const reason: Error = new Error('Request cancelled');

			// Act

			const result: Promise<unknown> = invoke(context, AbortSignal.abort(reason));

			// Assert

			await assert.rejects(result, (error: unknown): boolean => error === reason);
			assert.equal(executed, false);
		});
	}

	void it('preserves a non-Error cancellation reason as the rejection cause', async (t: TestContext): Promise<void> => {
		// Arrange

		const { context }: Harness = await createHarness(t, { session: { get: () => Effect.succeed(SESSION) } });
		const reason: { source: string } = { source: 'caller' };

		// Act

		const result: ReturnType<OpenCodeContext['session']['get']> = context.session.get(
			{ sessionID: SESSION.id },
			{ signal: AbortSignal.abort(reason) },
		);

		// Assert

		await assert.rejects(result, (error: unknown): boolean => {
			assert.ok(error instanceof Error);
			assert.equal(error.cause, reason);
			return true;
		});
	});

	void it('interrupts running work and allows a subsequent request to succeed', async (t: TestContext): Promise<void> => {
		// Arrange

		const controller: AbortController = new AbortController();
		const started: PromiseWithResolvers<void> = Promise.withResolvers();
		const interrupted: PromiseWithResolvers<void> = Promise.withResolvers();
		const { context }: Harness = await createHarness(t, {
			session: {
				generate: (input) =>
					input.prompt === 'pending'
						? Effect.callback(() => {
								started.resolve();
								return Effect.sync(() => {
									interrupted.resolve();
								});
							})
						: Effect.succeed({ text: 'Fresh result' }),
			},
		});
		t.after((): void => {
			controller.abort();
		});
		// Act

		const pending: Promise<{ text: string }> = context.session.generate(
			{ sessionID: SESSION.id, prompt: 'pending' },
			{ signal: controller.signal },
		);
		const settled: Promise<PromiseSettledResult<{ text: string }>[]> = Promise.allSettled([pending]);
		await started.promise;
		controller.abort();
		await settled;
		await interrupted.promise;

		const result: { text: string } = await context.session.generate(
			{ sessionID: SESSION.id, prompt: 'retry' },
			{ signal: new AbortController().signal },
		);

		// Assert

		await assert.rejects(pending);
		assert.deepEqual(result, { text: 'Fresh result' });
	});

	void it('forwards hook registration and preserves mutable events for synchronous callbacks', async (t: TestContext): Promise<void> => {
		// Arrange

		let received: SessionGenerate | undefined;
		const harness: HookHarness = await createHookHarness(t);
		const callback: HookCallback = (event): void => {
			received = event;
			event.system.push({ type: 'text', text: 'Review carefully' });
		};

		// Act

		await harness.context.session.hook('generate', callback, { providerID: 'provider-example' });
		await Effect.runPromise(hookCallbackEffect(harness));

		// Assert

		assert.equal(harness.hook.mock.calls[0].arguments[0], 'generate');
		assert.deepEqual(harness.hook.mock.calls[0].arguments[2], { providerID: 'provider-example' });
		assert.equal(received, harness.event);
		assert.deepEqual(harness.event.system, [{ type: 'text', text: 'Review carefully' }]);
	});

	void it('waits for an asynchronous hook callback to finish', async (t: TestContext): Promise<void> => {
		// Arrange

		const started: PromiseWithResolvers<void> = Promise.withResolvers();
		const finish: PromiseWithResolvers<void> = Promise.withResolvers();
		const events: string[] = [];
		t.after((): void => {
			finish.resolve();
		});
		const harness: HookHarness = await createHookHarness(t);
		const callback: HookCallback = async (event): Promise<void> => {
			started.resolve();
			await finish.promise;
			event.options.temperature = 0.2;
			events.push('callback finished');
		};
		// Act

		await harness.context.session.hook('generate', callback);
		const pending: Promise<void> = Effect.runPromise(hookCallbackEffect(harness)).then((): void => {
			events.push('Effect completed');
		});
		await started.promise;
		const earlyEvents: string[] = [...events];
		finish.resolve();
		await pending;

		// Assert

		assert.deepEqual(earlyEvents, []);
		assert.deepEqual(events, ['callback finished', 'Effect completed']);
		assert.equal(harness.event.options.temperature, 0.2);
	});

	for (const mode of ['throw', 'reject']) {
		void it(`propagates a hook callback ${mode} as a failed Effect`, async (t: TestContext): Promise<void> => {
			// Arrange

			const reason: Error = new Error('Hook failed');
			const harness: HookHarness = await createHookHarness(t);
			const callback: HookCallback = (): Promise<void> | void => {
				if (mode === 'throw') {
					throw reason;
				}
				return Promise.reject(reason);
			};

			// Act

			await harness.context.session.hook('generate', callback);
			const exit: Exit.Exit<void> = await Effect.runPromiseExit(hookCallbackEffect(harness));

			// Assert

			assert.ok(Exit.isFailure(exit));
		});
	}

	void it('aborts the hook callback signal when its Effect is interrupted', async (t: TestContext): Promise<void> => {
		// Arrange

		const started: PromiseWithResolvers<AbortSignal> = Promise.withResolvers<AbortSignal>();
		const finish: PromiseWithResolvers<void> = Promise.withResolvers();
		const controller: AbortController = new AbortController();
		t.after((): void => {
			controller.abort();
			finish.resolve();
		});
		const harness: HookHarness = await createHookHarness(t);
		const callback: HookCallback = (_event, signal): Promise<void> => {
			started.resolve(signal);
			return finish.promise;
		};
		// Act

		await harness.context.session.hook('generate', callback);
		const pending: Promise<Exit.Exit<void>> = Effect.runPromiseExit(hookCallbackEffect(harness), {
			signal: controller.signal,
		});
		const signal: AbortSignal = await started.promise;
		const abortedBeforeInterruption: boolean = signal.aborted;
		controller.abort();
		const exit: Exit.Exit<void> = await pending;

		// Assert

		assert.equal(abortedBeforeInterruption, false);
		assert.ok(Exit.isFailure(exit));
		assert.equal(signal.aborted, true);
	});

	void it('runs and awaits registration disposal', async (t: TestContext): Promise<void> => {
		// Arrange

		const started: PromiseWithResolvers<void> = Promise.withResolvers();
		const finish: PromiseWithResolvers<void> = Promise.withResolvers();
		const events: string[] = [];
		t.after((): void => {
			finish.resolve();
		});
		const disposal: Registration['dispose'] = Effect.promise(async (): Promise<void> => {
			started.resolve();
			await finish.promise;
			events.push('disposal finished');
		});
		const harness: HookHarness = await createHookHarness(t, disposal);
		const registration: Awaited<ReturnType<OpenCodeContext['session']['hook']>> =
			await harness.context.session.hook('generate', (): never => assert.fail('unexpected callback'));
		// Act

		const pending: Promise<void> = registration.dispose().then((): void => {
			events.push('promise resolved');
		});
		await started.promise;
		const earlyEvents: string[] = [...events];
		finish.resolve();
		await pending;

		// Assert

		assert.deepEqual(earlyEvents, []);
		assert.deepEqual(events, ['disposal finished', 'promise resolved']);
	});

	void it('keeps acquired resources alive until the owning scope closes', async (t: TestContext): Promise<void> => {
		// Arrange

		const events: string[] = [];
		const hook: EffectContext['session']['hook'] = () =>
			Effect.acquireRelease(
				Effect.sync(() => {
					events.push('acquired');
					return { dispose: Effect.void };
				}),
				() =>
					Effect.sync(() => {
						events.push('released');
					}),
			);
		const { context, close }: Harness = await createHarness(t, { session: { hook } });

		// Act

		await context.session.hook('generate', (): never => assert.fail('unexpected callback'));
		const eventsBeforeClose: string[] = [...events];
		await close();

		// Assert

		assert.deepEqual(eventsBeforeClose, ['acquired']);
		assert.deepEqual(events, ['acquired', 'released']);
	});

	void it('rejects the exposed promise when an underlying operation fails', async (t: TestContext): Promise<void> => {
		// Arrange

		const { context }: Harness = await createHarness(t, {
			session: { get: () => Effect.fail(new Error('Read failed')) },
		});

		// Act

		const result: ReturnType<OpenCodeContext['session']['get']> = context.session.get({ sessionID: SESSION.id });

		// Assert

		await assert.rejects(result);
	});
});
