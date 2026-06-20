import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, suite, test } from 'node:test';

import type { ChatMessageInput, ChatParts, PolisherResult } from 'english-prompt-polisher';

import { checkPrompt, type CheckerClient } from '../../src/checker/index.ts';
import { CHECKER_SESSION_DELETE_DELAY_MS } from '../../src/checker/session.ts';
import { normalizeOpenCodeOptions } from '../../src/options.ts';
import { chatInput, textPart } from '../fixtures.ts';

type PromptRequest = Parameters<CheckerClient['session']['prompt']>[0];
type PromptResult = Awaited<ReturnType<CheckerClient['session']['prompt']>>;
type CreateRequest = Parameters<CheckerClient['session']['create']>[0];
type CreateResult = Awaited<ReturnType<CheckerClient['session']['create']>>;
type DeleteRequest = Parameters<CheckerClient['session']['delete']>[0];
type ToolIdsRequest = Parameters<CheckerClient['tool']['ids']>[0];
type ToolIdsResult = Awaited<ReturnType<CheckerClient['tool']['ids']>>;
type CallName = 'tool.ids' | 'create' | 'prompt' | 'delete';
type CheckerClientFixture = {
	client: CheckerClient;
	toolIdsRequests: ToolIdsRequest[];
	creates: CreateRequest[];
	prompts: PromptRequest[];
	deletes: DeleteRequest[];
	calls: CallName[];
};
type CheckerClientOptions = {
	parts?: ChatParts;
	createError?: Error;
	promptError?: Error;
	toolIds?: string[];
	toolIdsError?: Error;
	toolIdsResult?: ToolIdsResult;
};
type CheckerToolApi = Pick<CheckerClient, 'tool'>;
type CheckerSessionApi = Pick<CheckerClient, 'session'>;

const input: ChatMessageInput = chatInput();
const checkerSessionID: string = 'checker_session';
const toolIds: string[] = ['bash', 'edit', 'grep'];
const disabledTools: Record<string, boolean> = { bash: false, edit: false, grep: false };
const expectedResult: PolisherResult = {
	needsProposal: true,
	detectedLanguage: 'Spanish',
	reason: 'Prompt is not English.',
	proposedPrompt: 'Correct this.',
};

const validParts: ChatParts = [textPart(JSON.stringify(expectedResult))];

function checkerToolApi(
	toolIdsRequests: ToolIdsRequest[],
	calls: CallName[],
	options: CheckerClientOptions,
): CheckerToolApi {
	const availableToolIds: string[] = options.toolIds ?? toolIds;
	return {
		tool: {
			ids: (request?: ToolIdsRequest): Promise<ToolIdsResult> => {
				calls.push('tool.ids');
				toolIdsRequests.push(request);
				if (options.toolIdsError) {
					return Promise.reject(options.toolIdsError);
				}
				return Promise.resolve(options.toolIdsResult ?? { data: availableToolIds });
			},
		},
	};
}

function checkerSessionApi(
	creates: CreateRequest[],
	prompts: PromptRequest[],
	deletes: DeleteRequest[],
	calls: CallName[],
	options: CheckerClientOptions,
): CheckerSessionApi {
	const parts: ChatParts = options.parts ?? validParts;
	return {
		session: {
			create: (request: CreateRequest): Promise<CreateResult> => {
				calls.push('create');
				creates.push(request);
				if (options.createError) {
					return Promise.reject(options.createError);
				}
				return Promise.resolve({ data: { id: checkerSessionID } });
			},
			prompt: (request: PromptRequest): Promise<PromptResult> => {
				calls.push('prompt');
				prompts.push(request);
				if (options.promptError) {
					return Promise.reject(options.promptError);
				}
				return Promise.resolve({ data: { parts } });
			},
			delete: (request: DeleteRequest): Promise<unknown> => {
				calls.push('delete');
				deletes.push(request);
				return Promise.resolve(undefined);
			},
		},
	};
}

function checkerClient(partsOrOptions: ChatParts | CheckerClientOptions = validParts): CheckerClientFixture {
	const options: CheckerClientOptions = Array.isArray(partsOrOptions) ? { parts: partsOrOptions } : partsOrOptions;
	const toolIdsRequests: ToolIdsRequest[] = [];
	const creates: CreateRequest[] = [];
	const prompts: PromptRequest[] = [];
	const deletes: DeleteRequest[] = [];
	const calls: CallName[] = [];
	const client: CheckerClient = {
		...checkerToolApi(toolIdsRequests, calls, options),
		...checkerSessionApi(creates, prompts, deletes, calls, options),
	};

	return { client, toolIdsRequests, creates, prompts, deletes, calls };
}

void suite('checkPrompt', () => {
	beforeEach((): void => {
		mock.timers.enable({ apis: ['setTimeout'] });
	});

	afterEach((): void => {
		mock.timers.reset();
	});

	void test('submits a checker request and deletes the temporary session by default', async () => {
		// Arrange

		const { client, creates, prompts, deletes, calls } = checkerClient(validParts);

		// Act

		const result: PolisherResult = await checkPrompt(
			client,
			input,
			normalizeOpenCodeOptions({ checker: { agent: 'build', model: 'openai/gpt-4.1' } }),
			'Corrige esto',
		);
		mock.timers.tick(CHECKER_SESSION_DELETE_DELAY_MS);

		// Assert

		assert.deepEqual(result, expectedResult);
		assert.deepEqual(creates, [{ body: { title: 'English prompt polish check', parentID: input.conversationId } }]);
		assert.equal(prompts.length, 1);
		assert.deepEqual(deletes, [{ path: { id: checkerSessionID } }]);
		assert.deepEqual(calls, ['tool.ids', 'create', 'prompt', 'delete']);

		const request: PromptRequest = prompts[0];
		assert.deepEqual(request.path, { id: checkerSessionID });
		assert.equal(request.body.agent, 'build');
		assert.deepEqual(request.body.model, { providerID: 'openai', modelID: 'gpt-4.1' });
		assert.deepEqual(request.body.tools, disabledTools);
		const firstPart: PromptRequest['body']['parts'][number] = request.body.parts[0];
		assert.equal(firstPart.type, 'text');
		assert.match(firstPart.text, /Corrige esto/);
	});

	void test('submits a checker request with default options', async () => {
		// Arrange

		const { client, prompts, deletes, calls } = checkerClient(validParts);

		// Act

		const result: PolisherResult = await checkPrompt(client, input, normalizeOpenCodeOptions(), 'Corrige esto');
		mock.timers.tick(CHECKER_SESSION_DELETE_DELAY_MS);

		// Assert

		assert.equal(result.proposedPrompt, expectedResult.proposedPrompt);
		assert.equal(prompts.length, 1);
		assert.deepEqual(deletes, [{ path: { id: checkerSessionID } }]);
		assert.deepEqual(calls, ['tool.ids', 'create', 'prompt', 'delete']);
	});

	void test('passes directory to tool, session, prompt, and delete requests', async () => {
		// Arrange

		const directory: string = '/workspace/project';
		const { client, toolIdsRequests, creates, prompts, deletes } = checkerClient(validParts);

		// Act

		await checkPrompt(client, input, normalizeOpenCodeOptions(), 'Corrige esto', directory);
		mock.timers.tick(CHECKER_SESSION_DELETE_DELAY_MS);

		// Assert

		assert.deepEqual(toolIdsRequests, [{ query: { directory } }]);
		assert.deepEqual(
			creates.map((request): CreateRequest['query'] => request.query),
			[{ directory }],
		);
		assert.deepEqual(
			creates.map((request): CreateRequest['body'] => request.body),
			[{ title: 'English prompt polish check', parentID: input.conversationId }],
		);
		assert.deepEqual(
			prompts.map((request): PromptRequest['query'] => request.query),
			[{ directory }],
		);
		assert.deepEqual(
			deletes.map((request): DeleteRequest['query'] => request.query),
			[{ directory }],
		);
	});

	void test('keeps the temporary session when cleanup is disabled', async () => {
		// Arrange

		const { client, prompts, deletes, calls } = checkerClient(validParts);

		// Act

		const result: PolisherResult = await checkPrompt(
			client,
			input,
			normalizeOpenCodeOptions({ checker: { deleteSession: false } }),
			'Corrige esto',
		);

		// Assert

		assert.equal(result.proposedPrompt, expectedResult.proposedPrompt);
		assert.equal(prompts.length, 1);
		assert.deepEqual(deletes, []);
		assert.deepEqual(calls, ['tool.ids', 'create', 'prompt']);
	});

	void test('rejects without creating a session when tool ids are unavailable', async () => {
		// Arrange

		const { client, creates, prompts, deletes, calls } = checkerClient({ toolIdsResult: { data: undefined } });

		// Act

		const act = (): Promise<PolisherResult> =>
			checkPrompt(client, input, normalizeOpenCodeOptions(), 'Corrige esto');

		// Assert

		await assert.rejects(act, /tool ids/);
		assert.deepEqual(creates, []);
		assert.deepEqual(prompts, []);
		assert.deepEqual(deletes, []);
		assert.deepEqual(calls, ['tool.ids']);
	});

	void test('deletes the temporary session when parsing fails', async () => {
		// Arrange

		const invalidParts: ChatParts = [textPart('not json')];
		const { client, deletes, calls } = checkerClient(invalidParts);

		// Act

		const act = (): Promise<PolisherResult> =>
			checkPrompt(client, input, normalizeOpenCodeOptions(), 'Corrige esto');

		// Assert

		await assert.rejects(act);
		mock.timers.tick(CHECKER_SESSION_DELETE_DELAY_MS);
		assert.deepEqual(deletes, [{ path: { id: checkerSessionID } }]);
		assert.deepEqual(calls, ['tool.ids', 'create', 'prompt', 'delete']);
	});

	void test('deletes the temporary session when prompting fails', async () => {
		// Arrange

		const promptError: Error = new Error('prompt failed');
		const { client, deletes, calls } = checkerClient({ promptError });

		// Act

		const act = (): Promise<PolisherResult> =>
			checkPrompt(client, input, normalizeOpenCodeOptions(), 'Corrige esto');

		// Assert

		await assert.rejects(act, (error: unknown): boolean => {
			assert.equal(error, promptError);
			return true;
		});
		mock.timers.tick(CHECKER_SESSION_DELETE_DELAY_MS);
		assert.deepEqual(deletes, [{ path: { id: checkerSessionID } }]);
		assert.deepEqual(calls, ['tool.ids', 'create', 'prompt', 'delete']);
	});

	void test('rejects without prompting or deleting when session creation fails', async () => {
		// Arrange

		const createError: Error = new Error('create failed');
		const { client, creates, prompts, deletes, calls } = checkerClient({ createError });

		// Act

		const act = (): Promise<PolisherResult> =>
			checkPrompt(client, input, normalizeOpenCodeOptions(), 'Corrige esto');

		// Assert

		await assert.rejects(act, (error: unknown): boolean => {
			assert.equal(error, createError);
			return true;
		});
		assert.equal(creates.length, 1);
		assert.deepEqual(prompts, []);
		assert.deepEqual(deletes, []);
		assert.deepEqual(calls, ['tool.ids', 'create']);
	});
});
