import { queryForDirectory, type DirectoryQuery } from './query.ts';

type ClientResult<T> = Promise<{ data: T | undefined }>;
type SessionCreateResultData = { id?: string };
type SessionCreateOptions = { body?: { parentID?: string; title?: string }; query?: { directory?: string } };
type SessionDeleteOptions = { path: { id: string }; query?: { directory?: string } };

export const CHECKER_SESSION_DELETE_DELAY_MS: number = 1000;

export type CheckerSessionClient = {
	session: {
		create: (options: SessionCreateOptions) => ClientResult<SessionCreateResultData>;
		delete: (options: SessionDeleteOptions) => Promise<unknown>;
	};
};

type Client = CheckerSessionClient;

async function createCheckerSession(client: Client, directory?: string, parentSessionID?: string): Promise<string> {
	const query: DirectoryQuery | undefined = queryForDirectory(directory);
	const body: NonNullable<SessionCreateOptions['body']> = { title: 'English prompt polish check' };
	if (parentSessionID !== undefined && parentSessionID.length > 0) {
		body.parentID = parentSessionID;
	}
	const session: Awaited<ReturnType<Client['session']['create']>> = await client.session.create({
		body,
		...(query === undefined ? {} : { query }),
	});
	const sessionID: string | undefined = session.data?.id;
	if (!sessionID) {
		throw new Error('OpenCode did not return a checker session id');
	}
	return sessionID;
}

async function deleteCheckerSession(client: Client, sessionID: string, directory?: string): Promise<void> {
	const query: DirectoryQuery | undefined = queryForDirectory(directory);
	try {
		await client.session.delete({ path: { id: sessionID }, ...(query === undefined ? {} : { query }) });
	} catch {
		return;
	}
}

function scheduleCheckerSessionDelete(
	client: Client,
	sessionID: string,
	directory?: string,
	delayMs: number = CHECKER_SESSION_DELETE_DELAY_MS,
): void {
	const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
		void deleteCheckerSession(client, sessionID, directory);
	}, delayMs);

	if (delayMs > 0) {
		timer.unref();
	}
}

export async function withCheckerSession<T>(
	client: Client,
	deleteSession: boolean,
	run: (sessionID: string) => Promise<T>,
	directory?: string,
	parentSessionID?: string,
	deleteDelayMs: number = CHECKER_SESSION_DELETE_DELAY_MS,
): Promise<T> {
	const sessionID: string = await createCheckerSession(client, directory, parentSessionID);

	try {
		return await run(sessionID);
	} finally {
		if (deleteSession) {
			scheduleCheckerSessionDelete(client, sessionID, directory, deleteDelayMs);
		}
	}
}
