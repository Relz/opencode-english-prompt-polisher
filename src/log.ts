import type { LogLevel, WriteLog } from 'english-prompt-polisher';

type LogBody = { service: string; level: LogLevel; message: string; extra?: Record<string, unknown> };

export type OpenCodeLogClient = {
	app: {
		log: (input: { body: LogBody }) => Promise<unknown>;
	};
};

export function createOpenCodeLog(client: OpenCodeLogClient): WriteLog {
	return async (level: LogLevel, message: string, extra?: Record<string, unknown>): Promise<void> => {
		try {
			const body: LogBody = {
				service: 'opencode-english-prompt-polisher',
				level,
				message,
			};

			if (extra !== undefined) {
				body.extra = extra;
			}

			await client.app.log({ body });
		} catch {
			// Logging must never block the user's prompt.
		}
	};
}
