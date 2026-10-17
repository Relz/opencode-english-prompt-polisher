import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setImmediate } from 'node:timers/promises';

import type { WriteLog } from 'english-prompt-polisher';

import { logPromptRunnerFailure, runPromptRunnerSafely } from '../../src/prompt-runners/logging.ts';
import type { OpenCodeChatMessageInput } from '../../src/types.ts';

const INPUT: OpenCodeChatMessageInput = {
	sessionID: 'session-1',
	messageID: 'message-1',
};
const FAILURE_MESSAGE: string = 'Failed to polish prompt';
const ACTION_ERROR: Error = new Error('Action failed');

function createLogRecorder(): { logs: Parameters<WriteLog>[]; writeLog: WriteLog } {
	const logs: Parameters<WriteLog>[] = [];
	return {
		logs,
		writeLog: (...args): Promise<void> => {
			logs.push(args);
			return Promise.resolve();
		},
	};
}

void describe('logPromptRunnerFailure', (): void => {
	const failures: { name: string; error: unknown; text: string }[] = [
		{ name: 'an Error', error: ACTION_ERROR, text: 'Action failed' },
		{ name: 'a thrown string', error: 'Service unavailable', text: 'Service unavailable' },
	];
	for (const { name, error, text } of failures) {
		void it(`logs one contextual warning for ${name}`, async (): Promise<void> => {
			// Arrange

			const { logs, writeLog } = createLogRecorder();

			// Act

			await logPromptRunnerFailure(writeLog, INPUT, FAILURE_MESSAGE, error);

			// Assert

			assert.deepEqual(logs, [
				['warn', FAILURE_MESSAGE, { sessionID: INPUT.sessionID, messageID: INPUT.messageID, error: text }],
			]);
		});
	}

	void it('logs successfully without an optional message ID', async (): Promise<void> => {
		// Arrange

		const { logs, writeLog } = createLogRecorder();

		// Act

		await logPromptRunnerFailure(writeLog, { sessionID: INPUT.sessionID }, FAILURE_MESSAGE, ACTION_ERROR);

		// Assert

		assert.equal(logs.length, 1);
		const [level, message, extra] = logs[0];
		assert.equal(level, 'warn');
		assert.equal(message, FAILURE_MESSAGE);
		assert.ok(extra);
		assert.equal(extra.sessionID, INPUT.sessionID);
		assert.equal(extra.messageID, undefined);
		assert.equal(extra.error, 'Action failed');
	});
});

void describe('runPromptRunnerSafely', (): void => {
	void it('returns the exact successful result without logging or repeating the action', async (): Promise<void> => {
		// Arrange

		const { logs, writeLog } = createLogRecorder();
		const expected: { text: string } = { text: 'Polished prompt' };
		let calls: number = 0;

		// Act

		const result: typeof expected | undefined = await runPromptRunnerSafely(
			writeLog,
			INPUT,
			FAILURE_MESSAGE,
			(): Promise<typeof expected> => {
				calls++;
				return Promise.resolve(expected);
			},
		);

		// Assert

		assert.equal(result, expected);
		assert.equal(calls, 1);
		assert.deepEqual(logs, []);
	});

	for (const mode of ['synchronous throw', 'asynchronous rejection'] as const) {
		void it(`logs once and resolves undefined after ${mode}`, async (): Promise<void> => {
			// Arrange

			const { logs, writeLog } = createLogRecorder();
			let calls: number = 0;

			// Act

			const result: string | undefined = await runPromptRunnerSafely(
				writeLog,
				INPUT,
				FAILURE_MESSAGE,
				(): Promise<string> => {
					calls++;
					if (mode === 'synchronous throw') {
						throw ACTION_ERROR;
					}
					return Promise.reject(ACTION_ERROR);
				},
			);

			// Assert

			assert.equal(result, undefined);
			assert.equal(calls, 1);
			assert.deepEqual(logs, [
				[
					'warn',
					FAILURE_MESSAGE,
					{ sessionID: INPUT.sessionID, messageID: INPUT.messageID, error: 'Action failed' },
				],
			]);
		});
	}
});

const loggingOperations: { name: string; invoke: (writeLog: WriteLog) => Promise<void> }[] = [
	{
		name: 'logPromptRunnerFailure',
		invoke: (writeLog): Promise<void> => logPromptRunnerFailure(writeLog, INPUT, FAILURE_MESSAGE, ACTION_ERROR),
	},
	{
		name: 'runPromptRunnerSafely after an action failure',
		invoke: async (writeLog): Promise<void> => {
			await runPromptRunnerSafely(writeLog, INPUT, FAILURE_MESSAGE, (): Promise<void> =>
				Promise.reject(ACTION_ERROR),
			);
		},
	},
];

for (const { name, invoke } of loggingOperations) {
	void describe(name, { timeout: 5000 }, (): void => {
		void it('waits for asynchronous logging to finish', async (): Promise<void> => {
			// Arrange

			const started: PromiseWithResolvers<void> = Promise.withResolvers();
			const finish: PromiseWithResolvers<void> = Promise.withResolvers();

			// Act

			const operation: Promise<void> = invoke((): Promise<void> => {
				started.resolve();
				return finish.promise;
			});

			// Assert

			try {
				await started.promise;
				// An event-loop checkpoint lets promise continuations run without a timed sleep.
				assert.equal(
					await Promise.race([operation.then((): string => 'completed'), setImmediate('pending')]),
					'pending',
				);
			} finally {
				finish.resolve();
				await operation;
			}
		});

		void it('propagates the exact logger error without another logging attempt', async (): Promise<void> => {
			// Arrange

			const loggerError: Error = new Error('Logging unavailable');
			let calls: number = 0;

			// Act

			const operation: Promise<void> = invoke((): Promise<void> => {
				calls++;
				return Promise.reject(loggerError);
			});

			// Assert

			await assert.rejects(operation, (error: unknown): boolean => error === loggerError);

			assert.equal(calls, 1);
		});
	});
}
