import { Plugin } from '@opencode/plugin/effect';
import { Effect } from 'effect';

import { createEffectContext } from './effect-context.ts';
import { setup, type OpenCodeContext } from './server.ts';

export default Plugin.define({
	id: 'opencode-english-prompt-polisher',
	effect: (ctx) =>
		Effect.gen(function* () {
			const context: OpenCodeContext = yield* createEffectContext(ctx);
			const cleanup: Awaited<ReturnType<typeof setup>> = yield* Effect.promise(() => setup(context));
			yield* Effect.addFinalizer(() => Effect.promise(() => Promise.resolve(cleanup())));
		}),
});
