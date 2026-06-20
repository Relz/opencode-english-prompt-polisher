import assert from 'node:assert/strict';
import { mock, suite, test } from 'node:test';

import type { Hooks } from '@opencode-ai/plugin';
import type { PolisherResult } from 'english-prompt-polisher';

import { CHECKER_SESSION_DELETE_DELAY_MS } from '../src/checker/session.ts';
import { createOpenCodeHooks, type OpenCodeClient } from '../src/server.ts';

import {
	chatMessageInput,
	chatMessageOutput,
	textChatMessagePart,
	type ChatMessageHookOutput,
	type ChatMessageHookPart,
} from './opencode-fixtures.ts';

type ChatMessageHook = NonNullable<Hooks['chat.message']>;
type AppLogRequest = Parameters<OpenCodeClient['app']['log']>[0];
type PromptRequest = Parameters<OpenCodeClient['session']['prompt']>[0];
type PromptResult = Awaited<ReturnType<OpenCodeClient['session']['prompt']>>;
type CreateRequest = Parameters<OpenCodeClient['session']['create']>[0];
type DeleteRequest = Parameters<OpenCodeClient['session']['delete']>[0];
type GetRequest = Parameters<OpenCodeClient['session']['get']>[0];
type ToolIdsRequest = Parameters<OpenCodeClient['tool']['ids']>[0];
type OpenCodeClientFixture = {
	client: OpenCodeClient;
	logs: AppLogRequest[];
	toolIdsRequests: ToolIdsRequest[];
	gets: GetRequest[];
	creates: CreateRequest[];
	prompts: PromptRequest[];
	deletes: DeleteRequest[];
};
type OpenCodeClientOptions = {
	promptError?: Error;
	promptFinished?: PromiseWithResolvers<PromptResult>;
	promptResult?: PromptResult;
	promptStarted?: PromiseWithResolvers<undefined>;
	sessionParentID?: string;
};
type OpenCodeLogApi = Pick<OpenCodeClient, 'app'>;
type OpenCodeToolApi = Pick<OpenCodeClient, 'tool'>;
type OpenCodeSessionApi = Pick<OpenCodeClient, 'session'>;

const changedResult: PolisherResult = {
	needsProposal: true,
	detectedLanguage: 'Spanish',
	reason: 'Prompt is not English.',
	proposedPrompt: 'Correct this.',
};

const unchangedResult: PolisherResult = {
	needsProposal: false,
	detectedLanguage: 'Spanish',
	reason: 'No proposal needed.',
	proposedPrompt: 'Corrige esto',
};

function promptResult(result: PolisherResult): PromptResult {
	return {
		data: {
			parts: [
				{
					id: 'checker_part',
					type: 'text',
					text: JSON.stringify(result),
				},
			],
		},
	};
}

function openCodeLogApi(logs: AppLogRequest[]): OpenCodeLogApi {
	return {
		app: {
			log: (request: AppLogRequest): Promise<unknown> => {
				logs.push(request);
				return Promise.resolve(undefined);
			},
		},
	};
}

function openCodeToolApi(toolIdsRequests: ToolIdsRequest[]): OpenCodeToolApi {
	return {
		tool: {
			ids: (request?: ToolIdsRequest): Promise<{ data: string[] }> => {
				toolIdsRequests.push(request);
				return Promise.resolve({ data: ['bash', 'edit'] });
			},
		},
	};
}

function openCodeSessionApi(
	gets: GetRequest[],
	creates: CreateRequest[],
	prompts: PromptRequest[],
	deletes: DeleteRequest[],
	options: OpenCodeClientOptions,
): OpenCodeSessionApi {
	return {
		session: {
			get: (request: GetRequest): Promise<{ data: { parentID?: string } }> => {
				gets.push(request);
				return Promise.resolve({
					data: options.sessionParentID === undefined ? {} : { parentID: options.sessionParentID },
				});
			},
			create: (request: CreateRequest): Promise<{ data: { id: string } }> => {
				creates.push(request);
				return Promise.resolve({ data: { id: 'checker_session' } });
			},
			prompt: (request: PromptRequest): Promise<PromptResult> => {
				prompts.push(request);
				if (options.promptStarted !== undefined) {
					options.promptStarted.resolve(undefined);
				}
				if (options.promptError !== undefined) {
					return Promise.reject(options.promptError);
				}
				if (options.promptFinished !== undefined) {
					return options.promptFinished.promise;
				}
				return Promise.resolve(options.promptResult ?? promptResult(unchangedResult));
			},
			delete: (request: DeleteRequest): Promise<unknown> => {
				deletes.push(request);
				return Promise.resolve(undefined);
			},
		},
	};
}

function openCodeClient(options: OpenCodeClientOptions = {}): OpenCodeClientFixture {
	const logs: AppLogRequest[] = [];
	const toolIdsRequests: ToolIdsRequest[] = [];
	const gets: GetRequest[] = [];
	const creates: CreateRequest[] = [];
	const prompts: PromptRequest[] = [];
	const deletes: DeleteRequest[] = [];
	const client: OpenCodeClient = {
		...openCodeLogApi(logs),
		...openCodeToolApi(toolIdsRequests),
		...openCodeSessionApi(gets, creates, prompts, deletes, options),
	};

	return { client, logs, toolIdsRequests, gets, creates, prompts, deletes };
}

function textOf(part: ChatMessageHookPart): string | undefined {
	return part.type === 'text' ? part.text : undefined;
}

void suite('createOpenCodeHooks', () => {
	void test('runs prompt polishing in the background without blocking chat.message', async () => {
		// Arrange

		const promptStarted: PromiseWithResolvers<undefined> = Promise.withResolvers<undefined>();
		const promptFinished: PromiseWithResolvers<PromptResult> = Promise.withResolvers<PromptResult>();
		const { client, prompts }: OpenCodeClientFixture = openCodeClient({ promptFinished, promptStarted });
		const hooks: Hooks = createOpenCodeHooks(client);
		const chatMessage: ChatMessageHook | undefined = hooks['chat.message'];

		// Act

		assert.ok(chatMessage);
		const firstCompleted: string = await Promise.race([
			chatMessage(chatMessageInput(), chatMessageOutput()).then((): string => 'hook'),
			promptStarted.promise.then((): string => 'checker'),
		]);

		// Assert

		assert.equal(firstCompleted, 'hook');
		assert.equal(prompts.length, 0);

		await promptStarted.promise;
		assert.equal(prompts.length, 1);

		promptFinished.resolve(promptResult(unchangedResult));
	});

	void test('rewrites user prompt parts in place before resolving in rewrite mode', async () => {
		// Arrange

		const promptStarted: PromiseWithResolvers<undefined> = Promise.withResolvers<undefined>();
		const promptFinished: PromiseWithResolvers<PromptResult> = Promise.withResolvers<PromptResult>();
		const { client, prompts }: OpenCodeClientFixture = openCodeClient({ promptFinished, promptStarted });
		const hooks: Hooks = createOpenCodeHooks(client, { mode: 'rewrite' });
		const chatMessage: ChatMessageHook | undefined = hooks['chat.message'];
		const output: ChatMessageHookOutput = chatMessageOutput([
			textChatMessagePart('Corrige esto', { id: 'prt_first' }),
			textChatMessagePart('Synthetic context', { id: 'prt_synthetic', synthetic: true }),
			textChatMessagePart('Por favor', { id: 'prt_second' }),
		]);
		const originalParts: ChatMessageHookOutput['parts'] = output.parts;

		// Act

		assert.ok(chatMessage);
		const hookPromise: Promise<void> = chatMessage(chatMessageInput(), output);
		const firstCompleted: string = await Promise.race([
			hookPromise.then((): string => 'hook'),
			promptStarted.promise.then((): string => 'checker'),
		]);

		// Assert

		assert.equal(firstCompleted, 'checker');
		assert.equal(textOf(output.parts[0]), 'Corrige esto');

		promptFinished.resolve(promptResult(changedResult));
		await hookPromise;

		assert.equal(output.parts, originalParts);
		assert.deepEqual(
			output.parts.map((part): string => part.id),
			['prt_first', 'prt_synthetic'],
		);
		assert.equal(textOf(output.parts[0]), 'Correct this.');
		assert.equal(textOf(output.parts[1]), 'Synthetic context');
		assert.match(prompts[0].body.parts[0].text, /Corrige esto\n\nPor favor/);
	});

	void test('passes directory to checker SDK calls', async () => {
		mock.timers.enable({ apis: ['setTimeout'] });

		try {
			// Arrange

			const directory: string = '/workspace/project';
			const { client, toolIdsRequests, gets, creates, prompts, deletes }: OpenCodeClientFixture = openCodeClient({
				promptResult: promptResult(unchangedResult),
			});
			const hooks: Hooks = createOpenCodeHooks(client, { mode: 'rewrite' }, directory);
			const chatMessage: ChatMessageHook | undefined = hooks['chat.message'];

			// Act

			assert.ok(chatMessage);
			await chatMessage(chatMessageInput(), chatMessageOutput([textChatMessagePart('Corrige esto')]));
			mock.timers.tick(CHECKER_SESSION_DELETE_DELAY_MS);

			// Assert

			assert.deepEqual(gets, [{ path: { id: 'ses_123' }, query: { directory } }]);
			assert.deepEqual(toolIdsRequests, [{ query: { directory } }]);
			assert.deepEqual(
				creates.map((request): CreateRequest['query'] => request.query),
				[{ directory }],
			);
			assert.deepEqual(
				creates.map((request): CreateRequest['body'] => request.body),
				[{ title: 'English prompt polish check', parentID: 'ses_123' }],
			);
			assert.deepEqual(
				prompts.map((request): PromptRequest['query'] => request.query),
				[{ directory }],
			);
			assert.deepEqual(deletes, [{ path: { id: 'checker_session' }, query: { directory } }]);
		} finally {
			mock.timers.reset();
		}
	});

	void test('skips child sessions before prompt polishing starts', async () => {
		// Arrange

		const { client, toolIdsRequests, gets, creates, prompts, deletes }: OpenCodeClientFixture = openCodeClient({
			sessionParentID: 'parent_session',
		});
		const hooks: Hooks = createOpenCodeHooks(client);
		const chatMessage: ChatMessageHook | undefined = hooks['chat.message'];

		// Act

		assert.ok(chatMessage);
		await chatMessage(chatMessageInput(), chatMessageOutput([textChatMessagePart('Subagent prompt')]));

		// Assert

		assert.deepEqual(gets, [{ path: { id: 'ses_123' } }]);
		assert.deepEqual(toolIdsRequests, []);
		assert.deepEqual(creates, []);
		assert.deepEqual(prompts, []);
		assert.deepEqual(deletes, []);
	});

	void test('keeps the original prompt when rewrite mode checker fails', async () => {
		// Arrange

		const { client, logs }: OpenCodeClientFixture = openCodeClient({ promptError: new Error('checker failed') });
		const hooks: Hooks = createOpenCodeHooks(client, { mode: 'rewrite' });
		const chatMessage: ChatMessageHook | undefined = hooks['chat.message'];
		const output: ChatMessageHookOutput = chatMessageOutput([textChatMessagePart('Corrige esto')]);

		// Act

		assert.ok(chatMessage);
		await chatMessage(chatMessageInput(), output);

		// Assert

		assert.equal(textOf(output.parts[0]), 'Corrige esto');
		assert.equal(logs.length, 1);
		assert.equal(logs[0].body.message, 'Failed to rewrite prompt');
	});
});
