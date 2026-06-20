import { queryForDirectory, type DirectoryQuery } from './checker/query.ts';

type ClientResult<T> = Promise<{ data: T | undefined }>;
type SessionGetOptions = { path: { id: string }; query?: DirectoryQuery };
type SessionGetResultData = { parentID?: string };

export type SessionLookupClient = {
	session: {
		get: (options: SessionGetOptions) => ClientResult<SessionGetResultData>;
	};
};

export type ShouldHandleSession = (sessionID: string) => Promise<boolean>;

async function isRootSession(client: SessionLookupClient, sessionID: string, directory?: string): Promise<boolean> {
	const query: DirectoryQuery | undefined = queryForDirectory(directory);
	const result: Awaited<ReturnType<SessionLookupClient['session']['get']>> = await client.session.get({
		path: { id: sessionID },
		...(query === undefined ? {} : { query }),
	});

	return result.data?.parentID === undefined;
}

export function createShouldHandleRootSession(client: SessionLookupClient, directory?: string): ShouldHandleSession {
	const cache: Map<string, Promise<boolean>> = new Map();

	return (sessionID: string): Promise<boolean> => {
		const cached: Promise<boolean> | undefined = cache.get(sessionID);
		if (cached !== undefined) {
			return cached;
		}

		const shouldHandle: Promise<boolean> = isRootSession(client, sessionID, directory).catch((): boolean => {
			cache.delete(sessionID);
			return true;
		});
		cache.set(sessionID, shouldHandle);
		return shouldHandle;
	};
}
