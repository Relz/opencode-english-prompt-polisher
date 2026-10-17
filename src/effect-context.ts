import { Agent, Location, Model, type Plugin } from '@opencode/plugin/effect';
import type { Registration } from '@opencode/plugin/effect/registration';
import { Session } from '@opencode/schema/session';
import { Effect, Schema, type Context, type Scope } from 'effect';

import type { OpenCodeContext } from './server-context.ts';

export type EffectContext = {
	options: Plugin.Context['options'];
	location: { directory: string };
	model: Pick<Plugin.Context['model'], 'default'>;
	session: Pick<Plugin.Context['session'], 'get' | 'create' | 'generate' | 'remove' | 'hook'>;
};

// Only expose the operations used by the Promise-based prompt orchestration.
// Unlike the V2 Promise adapter, this bridge passes signals to the Effect runner.
export const createEffectContext: (ctx: EffectContext) => Effect.Effect<OpenCodeContext, never, Scope.Scope> =
	Effect.fn('createEffectContext')(function* (
		ctx: EffectContext,
	): Effect.fn.Return<OpenCodeContext, never, Scope.Scope> {
		const runtime: Context.Context<Scope.Scope> = yield* Effect.context<Scope.Scope>();
		const run = <TResult, TError>(
			effect: Effect.Effect<TResult, TError, Scope.Scope>,
			options?: Effect.RunOptions,
		): Promise<TResult> => {
			// The runner can execute synchronous work before noticing a pre-aborted signal.
			if (options?.signal?.aborted === true) {
				const reason: unknown = options.signal.reason;
				return Promise.reject(
					reason instanceof Error ? reason : new Error('OpenCode operation was cancelled', { cause: reason }),
				);
			}
			return Effect.runPromiseWith(runtime)(effect, options);
		};
		return {
			options: ctx.options,
			location: ctx.location,
			model: {
				default: (input, requestOptions) =>
					run(
						ctx.model.default(input).pipe(
							Effect.map((result) => ({
								data:
									result.data === undefined
										? null
										: { id: result.data.id, providerID: result.data.providerID },
							})),
						),
						{ signal: requestOptions?.signal },
					),
			},
			session: {
				hook: async (name, callback, options): ReturnType<OpenCodeContext['session']['hook']> => {
					const registration: Registration = await run(
						ctx.session.hook(
							name,
							(event) => Effect.promise((signal) => Promise.resolve(callback(event, signal))),
							options,
						),
					);
					return { dispose: () => run(registration.dispose) };
				},
				get: (input, requestOptions) =>
					run(ctx.session.get({ sessionID: Session.ID.make(input.sessionID) }), {
						signal: requestOptions?.signal,
					}),
				create: (input, requestOptions) =>
					run(
						ctx.session.create({
							title: input?.title ?? undefined,
							parentID: input?.parentID == null ? undefined : Session.ID.make(input.parentID),
							agent: input?.agent == null ? undefined : Agent.ID.make(input.agent),
							model: input?.model == null ? undefined : Schema.decodeUnknownSync(Model.Ref)(input.model),
							location:
								input?.location == null
									? undefined
									: Schema.decodeUnknownSync(Location.PublicRef)(input.location),
						}),
						{ signal: requestOptions?.signal },
					),
				generate: (input, requestOptions) =>
					run(ctx.session.generate({ ...input, sessionID: Session.ID.make(input.sessionID) }), {
						signal: requestOptions?.signal,
					}),
				remove: (input, requestOptions) =>
					run(ctx.session.remove({ sessionID: Session.ID.make(input.sessionID) }), {
						signal: requestOptions?.signal,
					}),
			},
		};
	});
