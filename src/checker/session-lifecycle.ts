import type { Plugin } from '@opencode/plugin';

import type { PendingWorkRegistration } from '../pending-work-tracker.ts';

type SessionClient = Pick<Plugin.Context['session'], 'remove'> & {
	create: (...args: Parameters<Plugin.Context['session']['create']>) => Promise<{ id: string }>;
};

type SessionLifecycleContext = {
	session: SessionClient;
	registerPendingWork: PendingWorkRegistration['track'];
};

type SessionRequest = {
	create: Parameters<SessionClient['create']>[0];
	deleteSession: boolean;
	signal?: AbortSignal;
};

export async function withCheckerSession<T>(
	ctx: SessionLifecycleContext,
	request: SessionRequest,
	run: (sessionID: string) => Promise<T>,
): Promise<T> {
	request.signal?.throwIfAborted();
	// Do not let cancellation hide an acquired ID: always receive it and enter cleanup.
	const session: { id: string } = await ctx.session.create(request.create);
	try {
		request.signal?.throwIfAborted();
		const result: T = await run(session.id);
		request.signal?.throwIfAborted();
		return result;
	} finally {
		if (request.deleteSession) {
			// Detach removal from the result, but include it in the bounded unload drain.
			const removal: Promise<void> = Promise.resolve()
				.then((): Promise<void> => ctx.session.remove({ sessionID: session.id }))
				.catch((): void => {
					// Neither synchronous throws nor async failures may mask the check outcome.
				});
			ctx.registerPendingWork(removal);
		}
	}
}
