import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { createOpenCodeLog, type OpenCodeLogClient } from '../src/log.ts';

type CapturedAppLog = Parameters<OpenCodeLogClient['app']['log']>[0];

type CapturingLogClient = {
	client: OpenCodeLogClient;
	calls: CapturedAppLog[];
};

function createCapturingLogClient(): CapturingLogClient {
	const calls: CapturedAppLog[] = [];
	const client: OpenCodeLogClient = {
		app: {
			log: (input): Promise<unknown> => {
				calls.push(input);
				return Promise.resolve(undefined);
			},
		},
	};

	return { client, calls };
}

void suite('createOpenCodeLog', () => {
	void test('writes app log payloads with service metadata', async () => {
		// Arrange

		const { client, calls }: CapturingLogClient = createCapturingLogClient();
		const extra: Record<string, unknown> = { sessionID: 'ses_123', sink: 'file' };

		// Act

		await createOpenCodeLog(client)('warn', 'Failed to write proposal file', extra);

		// Assert

		assert.deepEqual(calls, [
			{
				body: {
					service: 'opencode-english-prompt-polisher',
					level: 'warn',
					message: 'Failed to write proposal file',
					extra,
				},
			},
		]);
	});

	void test('omits extra from app log payloads when no extra metadata is provided', async () => {
		// Arrange

		const { client, calls }: CapturingLogClient = createCapturingLogClient();

		// Act

		await createOpenCodeLog(client)('info', 'Wrote proposal file');

		// Assert

		assert.equal(calls.length, 1);
		assert.equal(calls[0].body.level, 'info');
		assert.equal(calls[0].body.message, 'Wrote proposal file');
		assert.equal(Object.hasOwn(calls[0].body, 'extra'), false);
	});

	void test('includes empty extra metadata when explicitly provided', async () => {
		// Arrange

		const { client, calls }: CapturingLogClient = createCapturingLogClient();
		const extra: Record<string, unknown> = {};

		// Act

		await createOpenCodeLog(client)('debug', 'Debugging proposal output', extra);

		// Assert

		assert.equal(calls.length, 1);
		assert.equal(calls[0].body.level, 'debug');
		assert.equal(calls[0].body.message, 'Debugging proposal output');
		assert.equal(calls[0].body.extra, extra);
	});

	void test('awaits app logger writes before resolving', async () => {
		// Arrange

		const events: string[] = [];
		let resolveLog: (() => void) | undefined;
		const client: OpenCodeLogClient = {
			app: {
				log: (): Promise<unknown> => {
					return new Promise<unknown>((resolve): void => {
						resolveLog = (): void => {
							events.push('app.log resolved');
							resolve(undefined);
						};
					});
				},
			},
		};

		// Act

		const write: Promise<void> = createOpenCodeLog(client)('info', 'Wrote proposal file').then((): void => {
			events.push('log resolved');
		});
		await Promise.resolve();

		// Assert

		assert.deepEqual(events, []);
		assert.ok(resolveLog);

		resolveLog();
		await write;

		assert.deepEqual(events, ['app.log resolved', 'log resolved']);
	});

	void test('does not reject when the app logger fails', async () => {
		// Arrange

		const client: OpenCodeLogClient = {
			app: {
				log: (): Promise<unknown> => Promise.reject(new Error('log transport failed')),
			},
		};

		// Act / Assert

		await assert.doesNotReject(createOpenCodeLog(client)('info', 'Wrote proposal file'));
	});

	void test('does not reject when the app logger throws synchronously', async () => {
		// Arrange

		const client: OpenCodeLogClient = {
			app: {
				log: (): Promise<unknown> => {
					throw new Error('log transport failed');
				},
			},
		};

		// Act / Assert

		await assert.doesNotReject(createOpenCodeLog(client)('error', 'Failed to write proposal file'));
	});
});
