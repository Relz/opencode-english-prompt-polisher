import { checkerOptions } from '../options.ts';
import type { OpenCodeContext } from '../server-context.ts';
import type { OpenCodeChatMessageInput, OpenCodeOptions } from '../types.ts';

export type CheckerModelResolverContext = {
	model: Pick<OpenCodeContext['model'], 'default'>;
};

export type CheckerModelSourceSession = Pick<
	Awaited<ReturnType<OpenCodeContext['session']['get']>>,
	'model' | 'location'
>;

export type CheckerModelResolver = (
	session: CheckerModelSourceSession,
	signal: AbortSignal,
) => Promise<OpenCodeChatMessageInput['model']>;

export function createCheckerModelResolver(
	ctx: CheckerModelResolverContext,
	options: OpenCodeOptions,
): CheckerModelResolver {
	return async (session, signal): Promise<OpenCodeChatMessageInput['model']> => {
		signal.throwIfAborted();
		const configuredModel: ReturnType<typeof checkerOptions>['model'] = checkerOptions(options).model;
		let model: OpenCodeChatMessageInput['model'] =
			session.model === undefined
				? undefined
				: {
						providerID: session.model.providerID,
						modelID: session.model.id,
						...(session.model.variant === undefined ? {} : { variant: session.model.variant }),
					};
		// Resolve only the source model; checker request policy selects any explicit override.
		if (model === undefined && (configuredModel === undefined || configuredModel === 'current')) {
			const defaultModel: Awaited<ReturnType<CheckerModelResolverContext['model']['default']>>['data'] = (
				await ctx.model.default({ location: { directory: session.location.directory } }, { signal })
			).data;
			model =
				defaultModel === null ? undefined : { providerID: defaultModel.providerID, modelID: defaultModel.id };
		}
		signal.throwIfAborted();
		return model;
	};
}
