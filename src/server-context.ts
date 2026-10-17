import type { Plugin } from '@opencode/plugin';
import type { ModelHookOptions, Registration } from '@opencode/plugin/promise/registration';
import type { SessionHooks } from '@opencode/plugin/promise/session';

import type { CheckerContext } from './checker/index.ts';

type SessionSnapshot = Pick<
	Awaited<ReturnType<Plugin.Context['session']['get']>>,
	'id' | 'parentID' | 'model' | 'location'
>;
type DefaultModel = Pick<
	NonNullable<Awaited<ReturnType<Plugin.Context['model']['default']>>['data']>,
	'id' | 'providerID'
>;

export type OpenCodeContext = CheckerContext & {
	options: Plugin.Context['options'];
	session: {
		hook: <TName extends keyof SessionHooks>(
			name: TName,
			callback: (event: SessionHooks[TName], signal: AbortSignal) => Promise<void> | void,
			options?: SessionHooks[TName] extends { readonly model: unknown } ? ModelHookOptions : never,
		) => Promise<Registration>;
		get: (...args: Parameters<Plugin.Context['session']['get']>) => Promise<SessionSnapshot>;
	};
	model: {
		default: (...args: Parameters<Plugin.Context['model']['default']>) => Promise<{ data: DefaultModel | null }>;
	};
};
