import assert from 'node:assert/strict';
import { mock, suite, test } from 'node:test';

import {
	CHECKER_SESSION_DELETE_DELAY_MS,
	withCheckerSession,
	type CheckerSessionClient,
} from '../../src/checker/session.ts';

const CHECKER_SESSION_ID: string = 'checker_session';
const IMMEDIATE_DELETE_DELAY_MS: number = 0;

type CreateRequest = Parameters<CheckerSessionClient['session']['create']>[0];
type CreateResult = Awaited<ReturnType<CheckerSessionClient['session']['create']>>;
type DeleteRequest = Parameters<CheckerSessionClient['session']['delete']>[0];
type CallName = 'create' | 'run' | 'delete';
type CheckerSessionClientFixture = {
	client: CheckerSessionClient;
	creates: CreateRequest[];
	deletes: DeleteRequest[];
	calls: CallName[];
};
type CheckerSessionClientOptions = {
	createResult?: CreateResult;
	createError?: Error;
	deleteError?: Error;
	deleteResult?: Promise<unknown>;
	onDelete?: () => void;
};

function checkerSessionClient(options: CheckerSessionClientOptions = {}): CheckerSessionClientFixture {
	const createResult: CreateResult = options.createResult ?? { data: { id: CHECKER_SESSION_ID } };
	const creates: CreateRequest[] = [];
	const deletes: DeleteRequest[] = [];
	const calls: CallName[] = [];
	const client: CheckerSessionClient = {
		session: {
			create: (request: CreateRequest): Promise<CreateResult> => {
				calls.push('create');
				creates.push(request);
				if (options.createError) {
					return Promise.reject(options.createError);
				}
				return Promise.resolve(createResult);
			},
			delete: (request: DeleteRequest): Promise<unknown> => {
				calls.push('delete');
				deletes.push(request);
				if (options.onDelete) {
					options.onDelete();
				}
				if (options.deleteError) {
					return Promise.reject(options.deleteError);
				}
				if (options.deleteResult) {
					return options.deleteResult;
				}
				return Promise.resolve(undefined);
			},
		},
	};

	return { client, creates, deletes, calls };
}

function withImmediateCheckerSession<T>(
	client: CheckerSessionClient,
	deleteSession: boolean,
	run: (sessionID: string) => Promise<T>,
	directory?: string,
	parentSessionID?: string,
): Promise<T> {
	return withCheckerSession(client, deleteSession, run, directory, parentSessionID, IMMEDIATE_DELETE_DELAY_MS);
}

function waitForScheduledDelete(): Promise<void> {
	return new Promise((resolve): void => {
		setTimeout(resolve, 0);
	});
}

void suite('withCheckerSession', () => {
	void test('creates a checker session, runs with its id, and deletes it after success', async () => {
		// Arrange

		const { client, creates, deletes, calls } = checkerSessionClient();

		// Act

		const result: string = await withImmediateCheckerSession(client, true, (sessionID: string): Promise<string> => {
			calls.push('run');
			assert.equal(sessionID, CHECKER_SESSION_ID);
			return Promise.resolve('checked');
		});
		await waitForScheduledDelete();

		// Assert

		assert.equal(result, 'checked');
		assert.equal(creates.length, 1);
		assert.ok(creates[0].body?.title);
		assert.deepEqual(deletes, [{ path: { id: CHECKER_SESSION_ID } }]);
		assert.deepEqual(calls, ['create', 'run', 'delete']);
	});

	void test('passes directory to checker session create and delete requests', async () => {
		// Arrange

		const directory: string = '/workspace/project';
		const { client, creates, deletes, calls } = checkerSessionClient();

		// Act

		const result: string = await withImmediateCheckerSession(
			client,
			true,
			(sessionID: string): Promise<string> => {
				calls.push('run');
				assert.equal(sessionID, CHECKER_SESSION_ID);
				return Promise.resolve('checked');
			},
			directory,
		);
		await waitForScheduledDelete();

		// Assert

		assert.equal(result, 'checked');
		assert.deepEqual(
			creates.map((request): CreateRequest['query'] => request.query),
			[{ directory }],
		);
		assert.deepEqual(deletes, [{ path: { id: CHECKER_SESSION_ID }, query: { directory } }]);
		assert.deepEqual(calls, ['create', 'run', 'delete']);
	});

	void test('creates checker sessions as children when a parent session id is provided', async () => {
		// Arrange

		const parentSessionID: string = 'parent_session';
		const { client, creates, deletes, calls } = checkerSessionClient();

		// Act

		const result: string = await withImmediateCheckerSession(
			client,
			true,
			(sessionID: string): Promise<string> => {
				calls.push('run');
				assert.equal(sessionID, CHECKER_SESSION_ID);
				return Promise.resolve('checked');
			},
			undefined,
			parentSessionID,
		);
		await waitForScheduledDelete();

		// Assert

		assert.equal(result, 'checked');
		assert.deepEqual(creates, [{ body: { title: 'English prompt polish check', parentID: parentSessionID } }]);
		assert.deepEqual(deletes, [{ path: { id: CHECKER_SESSION_ID } }]);
		assert.deepEqual(calls, ['create', 'run', 'delete']);
	});

	void test('keeps the checker session when cleanup is disabled', async () => {
		// Arrange

		const { client, deletes, calls } = checkerSessionClient();

		// Act

		const result: string = await withImmediateCheckerSession(
			client,
			false,
			(sessionID: string): Promise<string> => {
				calls.push('run');
				assert.equal(sessionID, CHECKER_SESSION_ID);
				return Promise.resolve('checked');
			},
		);

		// Assert

		assert.equal(result, 'checked');
		assert.deepEqual(deletes, []);
		assert.deepEqual(calls, ['create', 'run']);
	});

	void test('keeps the checker session when cleanup is disabled and the run callback fails', async () => {
		// Arrange

		const runError: Error = new Error('run failed');
		const { client, deletes, calls } = checkerSessionClient();

		// Act

		const act = (): Promise<string> =>
			withImmediateCheckerSession(client, false, (sessionID: string): Promise<string> => {
				calls.push('run');
				assert.equal(sessionID, CHECKER_SESSION_ID);
				return Promise.reject(runError);
			});

		// Assert

		await assert.rejects(act, (error: unknown): boolean => {
			assert.equal(error, runError);
			return true;
		});
		assert.deepEqual(deletes, []);
		assert.deepEqual(calls, ['create', 'run']);
	});

	void test('rejects without running or deleting when session creation fails', async () => {
		// Arrange

		const createError: Error = new Error('create failed');
		const { client, deletes, calls } = checkerSessionClient({ createError });
		let ran: boolean = false;

		// Act

		const act = (): Promise<string> =>
			withCheckerSession(client, true, (): Promise<string> => {
				ran = true;
				return Promise.resolve('checked');
			});

		// Assert

		await assert.rejects(act, (error: unknown): boolean => {
			assert.equal(error, createError);
			return true;
		});
		assert.equal(ran, false);
		assert.deepEqual(deletes, []);
		assert.deepEqual(calls, ['create']);
	});

	const missingSessionIDCases: { name: string; createResult: CreateResult }[] = [
		{ name: 'undefined data', createResult: { data: undefined } },
		{ name: 'missing id', createResult: { data: {} } },
		{ name: 'empty id', createResult: { data: { id: '' } } },
	];

	for (const testCase of missingSessionIDCases) {
		void test(`rejects without running or deleting when session creation returns ${testCase.name}`, async () => {
			// Arrange

			const { client, deletes, calls } = checkerSessionClient({ createResult: testCase.createResult });
			let ran: boolean = false;

			// Act

			const act = (): Promise<string> =>
				withCheckerSession(client, true, (): Promise<string> => {
					ran = true;
					return Promise.resolve('checked');
				});

			// Assert

			await assert.rejects(act);
			assert.equal(ran, false);
			assert.deepEqual(deletes, []);
			assert.deepEqual(calls, ['create']);
		});
	}

	void test('deletes the checker session when the run callback fails', async () => {
		// Arrange

		const runError: Error = new Error('run failed');
		const { client, deletes, calls } = checkerSessionClient();

		// Act

		const act = (): Promise<string> =>
			withImmediateCheckerSession(client, true, (): Promise<string> => {
				calls.push('run');
				return Promise.reject(runError);
			});

		// Assert

		await assert.rejects(act, (error: unknown): boolean => {
			assert.equal(error, runError);
			return true;
		});
		await waitForScheduledDelete();
		assert.deepEqual(deletes, [{ path: { id: CHECKER_SESSION_ID } }]);
		assert.deepEqual(calls, ['create', 'run', 'delete']);
	});

	void test('deletes the checker session when the run callback throws synchronously', async () => {
		// Arrange

		const runError: Error = new Error('run failed');
		const { client, deletes, calls } = checkerSessionClient();

		// Act

		const act = (): Promise<string> =>
			withImmediateCheckerSession(client, true, (): Promise<string> => {
				calls.push('run');
				throw runError;
			});

		// Assert

		await assert.rejects(act, (error: unknown): boolean => {
			assert.equal(error, runError);
			return true;
		});
		await waitForScheduledDelete();
		assert.deepEqual(deletes, [{ path: { id: CHECKER_SESSION_ID } }]);
		assert.deepEqual(calls, ['create', 'run', 'delete']);
	});

	void test('ignores cleanup failures after a successful run', async () => {
		// Arrange

		const deleteError: Error = new Error('delete failed');
		const { client, deletes, calls } = checkerSessionClient({ deleteError });

		// Act

		const result: string = await withImmediateCheckerSession(client, true, (): Promise<string> => {
			calls.push('run');
			return Promise.resolve('checked');
		});
		await waitForScheduledDelete();

		// Assert

		assert.equal(result, 'checked');
		assert.deepEqual(deletes, [{ path: { id: CHECKER_SESSION_ID } }]);
		assert.deepEqual(calls, ['create', 'run', 'delete']);
	});

	void test('waits for the run callback to settle before deleting', async () => {
		// Arrange

		const runStarted: PromiseWithResolvers<undefined> = Promise.withResolvers<undefined>();
		const runFinished: PromiseWithResolvers<string> = Promise.withResolvers<string>();
		const { client, deletes, calls } = checkerSessionClient();

		// Act

		const result: Promise<string> = withImmediateCheckerSession(
			client,
			true,
			(sessionID: string): Promise<string> => {
				calls.push('run');
				assert.equal(sessionID, CHECKER_SESSION_ID);
				runStarted.resolve(undefined);
				return runFinished.promise;
			},
		);
		await runStarted.promise;

		// Assert

		assert.deepEqual(deletes, []);
		assert.deepEqual(calls, ['create', 'run']);

		runFinished.resolve('checked');
		assert.equal(await result, 'checked');
		assert.deepEqual(deletes, []);
		assert.deepEqual(calls, ['create', 'run']);

		await waitForScheduledDelete();
		assert.deepEqual(deletes, [{ path: { id: CHECKER_SESSION_ID } }]);
		assert.deepEqual(calls, ['create', 'run', 'delete']);
	});

	void test('uses a delayed cleanup by default', async () => {
		mock.timers.enable({ apis: ['setTimeout'] });

		try {
			// Arrange

			const { client, deletes, calls } = checkerSessionClient();

			// Act

			const result: string = await withCheckerSession(client, true, (): Promise<string> => {
				calls.push('run');
				return Promise.resolve('checked');
			});

			// Assert

			assert.equal(result, 'checked');
			assert.deepEqual(deletes, []);
			assert.deepEqual(calls, ['create', 'run']);

			mock.timers.tick(CHECKER_SESSION_DELETE_DELAY_MS - 1);
			assert.deepEqual(deletes, []);
			assert.deepEqual(calls, ['create', 'run']);

			mock.timers.tick(1);
			assert.deepEqual(deletes, [{ path: { id: CHECKER_SESSION_ID } }]);
			assert.deepEqual(calls, ['create', 'run', 'delete']);
		} finally {
			mock.timers.reset();
		}
	});

	void test('does not wait for cleanup before resolving after a successful run', async () => {
		// Arrange

		const deleteStarted: PromiseWithResolvers<undefined> = Promise.withResolvers<undefined>();
		const deleteFinished: PromiseWithResolvers<unknown> = Promise.withResolvers<unknown>();
		const { client, deletes, calls } = checkerSessionClient({
			deleteResult: deleteFinished.promise,
			onDelete: (): void => {
				deleteStarted.resolve(undefined);
			},
		});

		// Act

		const result: Promise<string> = withImmediateCheckerSession(client, true, (): Promise<string> => {
			calls.push('run');
			return Promise.resolve('checked');
		});

		// Assert

		assert.equal(await result, 'checked');
		assert.deepEqual(deletes, []);
		assert.deepEqual(calls, ['create', 'run']);

		await deleteStarted.promise;
		assert.deepEqual(deletes, [{ path: { id: CHECKER_SESSION_ID } }]);
		assert.deepEqual(calls, ['create', 'run', 'delete']);
		deleteFinished.resolve(undefined);
	});

	void test('does not wait for cleanup before rejecting after a failed run', async () => {
		// Arrange

		const runError: Error = new Error('run failed');
		const deleteStarted: PromiseWithResolvers<undefined> = Promise.withResolvers<undefined>();
		const deleteFinished: PromiseWithResolvers<unknown> = Promise.withResolvers<unknown>();
		const { client, deletes, calls } = checkerSessionClient({
			deleteResult: deleteFinished.promise,
			onDelete: (): void => {
				deleteStarted.resolve(undefined);
			},
		});

		// Act

		const result: Promise<string> = withImmediateCheckerSession(client, true, (): Promise<string> => {
			calls.push('run');
			return Promise.reject(runError);
		});

		// Assert

		await assert.rejects(
			(): Promise<string> => result,
			(error: unknown): boolean => {
				assert.equal(error, runError);
				return true;
			},
		);
		assert.deepEqual(deletes, []);
		assert.deepEqual(calls, ['create', 'run']);

		await deleteStarted.promise;
		assert.deepEqual(deletes, [{ path: { id: CHECKER_SESSION_ID } }]);
		assert.deepEqual(calls, ['create', 'run', 'delete']);
		deleteFinished.resolve(undefined);
	});

	void test('keeps the original run failure when cleanup fails', async () => {
		// Arrange

		const runError: Error = new Error('run failed');
		const deleteError: Error = new Error('delete failed');
		const { client, deletes, calls } = checkerSessionClient({ deleteError });

		// Act

		const act = (): Promise<string> =>
			withImmediateCheckerSession(client, true, (): Promise<string> => {
				calls.push('run');
				return Promise.reject(runError);
			});

		// Assert

		await assert.rejects(act, (error: unknown): boolean => {
			assert.equal(error, runError);
			return true;
		});
		await waitForScheduledDelete();
		assert.deepEqual(deletes, [{ path: { id: CHECKER_SESSION_ID } }]);
		assert.deepEqual(calls, ['create', 'run', 'delete']);
	});

	void test('keeps the original synchronous run failure when cleanup fails', async () => {
		// Arrange

		const runError: Error = new Error('run failed');
		const deleteError: Error = new Error('delete failed');
		const { client, deletes, calls } = checkerSessionClient({ deleteError });

		// Act

		const act = (): Promise<string> =>
			withImmediateCheckerSession(client, true, (): Promise<string> => {
				calls.push('run');
				throw runError;
			});

		// Assert

		await assert.rejects(act, (error: unknown): boolean => {
			assert.equal(error, runError);
			return true;
		});
		await waitForScheduledDelete();
		assert.deepEqual(deletes, [{ path: { id: CHECKER_SESSION_ID } }]);
		assert.deepEqual(calls, ['create', 'run', 'delete']);
	});
});
