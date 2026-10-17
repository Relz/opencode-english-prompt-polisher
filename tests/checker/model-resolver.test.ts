import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Location } from '@opencode/schema/location';
import { Model } from '@opencode/schema/model';
import { Provider } from '@opencode/schema/provider';

import {
	createCheckerModelResolver,
	type CheckerModelResolver,
	type CheckerModelResolverContext,
	type CheckerModelSourceSession,
} from '../../src/checker/model-resolver.ts';
import type { OpenCodeOptions } from '../../src/types.ts';

type DefaultLookup = CheckerModelResolverContext['model']['default'];
type DefaultResult = Awaited<ReturnType<DefaultLookup>>;
type Harness = {
	resolve: CheckerModelResolver;
	calls: Parameters<DefaultLookup>[];
};

const OPTIONS: OpenCodeOptions = { outputFile: 'unused.md' };
const SESSION: CheckerModelSourceSession & { model: NonNullable<CheckerModelSourceSession['model']> } = {
	model: {
		providerID: Provider.ID.make('session-provider'),
		id: Model.ID.make('session-model'),
	},
	location: { directory: Location.Ref.fields.directory.make('/source-project') },
};
const SESSION_WITHOUT_MODEL: CheckerModelSourceSession = { ...SESSION, model: undefined };
const DEFAULT_RESULT: DefaultResult = {
	data: {
		providerID: Provider.ID.make('default-provider'),
		id: Model.ID.make('default-model'),
	},
};
const OVERRIDE_OPTIONS: OpenCodeOptions = {
	...OPTIONS,
	checker: { model: { providerID: 'override-provider', modelID: 'override-model' } },
};

function createHarness(
	options: OpenCodeOptions = OPTIONS,
	lookup: DefaultLookup = (): Promise<DefaultResult> => Promise.resolve(DEFAULT_RESULT),
): Harness {
	const calls: Parameters<DefaultLookup>[] = [];
	return {
		resolve: createCheckerModelResolver(
			{
				model: {
					default: (...args): Promise<DefaultResult> => {
						calls.push(args);
						return lookup(...args);
					},
				},
			},
			options,
		),
		calls,
	};
}

void describe('checker model resolver', { timeout: 5000 }, (): void => {
	for (const variant of [undefined, Model.VariantID.make('reasoning')]) {
		void it(`maps the session model ${variant === undefined ? 'without' : 'with'} a variant without looking up a default`, async (): Promise<void> => {
			// Arrange

			const harness: Harness = createHarness();
			const session: CheckerModelSourceSession = { ...SESSION, model: { ...SESSION.model, variant } };

			// Act

			const model: Awaited<ReturnType<CheckerModelResolver>> = await harness.resolve(
				session,
				new AbortController().signal,
			);

			// Assert

			assert.ok(model);
			assert.equal(model.providerID, 'session-provider');
			assert.equal(model.modelID, 'session-model');
			assert.equal(model.variant, variant);
			assert.equal(harness.calls.length, 0);
		});
	}

	void it('returns the session model rather than applying an explicit checker override', async (): Promise<void> => {
		// Arrange

		const harness: Harness = createHarness(OVERRIDE_OPTIONS);
		const session: CheckerModelSourceSession = {
			...SESSION,
			model: { ...SESSION.model, variant: Model.VariantID.make('reasoning') },
		};

		// Act

		const model: Awaited<ReturnType<CheckerModelResolver>> = await harness.resolve(
			session,
			new AbortController().signal,
		);

		// Assert

		assert.deepEqual(model, {
			providerID: 'session-provider',
			modelID: 'session-model',
			variant: 'reasoning',
		});
		assert.equal(harness.calls.length, 0);
	});

	for (const configuredModel of [undefined, 'current'] as const) {
		void it(`looks up the directory default when the session has no model and checker model is ${configuredModel ?? 'unset'}`, async (): Promise<void> => {
			// Arrange

			const harness: Harness = createHarness(
				configuredModel === undefined ? OPTIONS : { ...OPTIONS, checker: { model: configuredModel } },
			);
			const signal: AbortSignal = new AbortController().signal;

			// Act

			const model: Awaited<ReturnType<CheckerModelResolver>> = await harness.resolve(
				SESSION_WITHOUT_MODEL,
				signal,
			);

			// Assert

			assert.deepEqual(model, {
				providerID: 'default-provider',
				modelID: 'default-model',
			});
			assert.equal(harness.calls.length, 1);
			const [request, lookupOptions]: Parameters<DefaultLookup> = harness.calls[0];
			assert.deepEqual(request, { location: { directory: SESSION.location.directory } });
			assert.equal(lookupOptions?.signal, signal);
		});
	}

	void it('leaves override selection to request policy without looking up a default', async (): Promise<void> => {
		// Arrange

		const harness: Harness = createHarness(OVERRIDE_OPTIONS);

		// Act

		const model: Awaited<ReturnType<CheckerModelResolver>> = await harness.resolve(
			SESSION_WITHOUT_MODEL,
			new AbortController().signal,
		);

		// Assert

		assert.equal(model, undefined);
		assert.equal(harness.calls.length, 0);
	});

	void it('returns undefined when no default model is available', async (): Promise<void> => {
		// Arrange

		const harness: Harness = createHarness(OPTIONS, (): Promise<DefaultResult> => Promise.resolve({ data: null }));

		// Act

		const model: Awaited<ReturnType<CheckerModelResolver>> = await harness.resolve(
			SESSION_WITHOUT_MODEL,
			new AbortController().signal,
		);

		// Assert

		assert.equal(model, undefined);
	});

	void it('preserves default lookup failures', async (): Promise<void> => {
		// Arrange

		const failure: Error = new Error('Default lookup failed');
		const harness: Harness = createHarness(OPTIONS, (): Promise<DefaultResult> => Promise.reject(failure));

		// Act

		const result: ReturnType<CheckerModelResolver> = harness.resolve(
			SESSION_WITHOUT_MODEL,
			new AbortController().signal,
		);

		// Assert

		await assert.rejects(result, (error: unknown): boolean => error === failure);
	});

	for (const session of [SESSION, SESSION_WITHOUT_MODEL]) {
		void it(`rejects an already-aborted signal ${session.model === undefined ? 'before default lookup' : 'despite an available session model'}`, async (): Promise<void> => {
			// Arrange

			const harness: Harness = createHarness();
			const controller: AbortController = new AbortController();
			const reason: Error = new Error('Cancelled before resolution');
			controller.abort(reason);

			// Act

			const result: ReturnType<CheckerModelResolver> = harness.resolve(session, controller.signal);

			// Assert

			await assert.rejects(result, (error: unknown): boolean => error === reason);
			assert.equal(harness.calls.length, 0);
		});
	}

	void it('rejects a model returned after cancellation even when the lookup ignores the signal', async (): Promise<void> => {
		// Arrange

		const started: PromiseWithResolvers<void> = Promise.withResolvers();
		const lookup: PromiseWithResolvers<DefaultResult> = Promise.withResolvers();
		const harness: Harness = createHarness(OPTIONS, (): Promise<DefaultResult> => {
			started.resolve();
			return lookup.promise;
		});
		const controller: AbortController = new AbortController();
		const reason: Error = new Error('Cancelled during default lookup');

		// Act

		const result: ReturnType<CheckerModelResolver> = harness.resolve(SESSION_WITHOUT_MODEL, controller.signal);
		const settled: Promise<PromiseSettledResult<Awaited<ReturnType<CheckerModelResolver>>>[]> = Promise.allSettled([
			result,
		]);

		await started.promise;
		controller.abort(reason);
		lookup.resolve(DEFAULT_RESULT);

		// Assert

		await settled;
		await assert.rejects(result, (error: unknown): boolean => error === reason);
	});
});
