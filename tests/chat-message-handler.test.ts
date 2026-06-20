import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import type { ChatMessageInput, ChatMessageOutput } from 'english-prompt-polisher';

import { createOpenCodeChatMessageHandler, type OpenCodeChatMessageHandler } from '../src/chat-message-handler.ts';
import type { OpenCodeMessageDedupeInput, ShouldHandleMessage } from '../src/message-dedupe.ts';
import { normalizeOpenCodeOptions } from '../src/options.ts';
import type { OpenCodePromptRunners } from '../src/prompt-runners.ts';
import type { ShouldHandleSession } from '../src/session-filter.ts';
import type { OpenCodeChatMessageInput } from '../src/types.ts';

import { chatMessageInput, chatMessageOutput, type ChatMessageHookOutput } from './opencode-fixtures.ts';

type RunnerCall = {
	mode: 'proposal' | 'rewrite';
	input: OpenCodeChatMessageInput;
	coreInput: ChatMessageInput;
	output: ChatMessageOutput;
};

function promptRunners(calls: RunnerCall[]): OpenCodePromptRunners {
	return {
		propose: (input, coreInput, output): void => {
			calls.push({ mode: 'proposal', input, coreInput, output });
		},
		rewrite: (input, coreInput, output): Promise<void> => {
			calls.push({ mode: 'rewrite', input, coreInput, output });
			return Promise.resolve();
		},
	};
}

const shouldHandleRootSession: ShouldHandleSession = (): Promise<boolean> => Promise.resolve(true);

void suite('createOpenCodeChatMessageHandler', () => {
	void test('routes handled messages to proposal mode by default', async () => {
		const calls: RunnerCall[] = [];
		const output: ChatMessageHookOutput = chatMessageOutput();
		const handler: OpenCodeChatMessageHandler = createOpenCodeChatMessageHandler(
			normalizeOpenCodeOptions(),
			shouldHandleRootSession,
			(): boolean => true,
			promptRunners(calls),
			(): string => 'fallback_1',
		);

		await handler(chatMessageInput(), output);

		assert.equal(calls.length, 1);
		assert.equal(calls[0].mode, 'proposal');
		assert.deepEqual(calls[0].coreInput, {
			conversationId: 'ses_123',
			messageId: 'msg_456',
			model: { providerID: 'anthropic', modelID: 'claude' },
		});
		assert.equal(calls[0].output, output);
	});

	void test('routes handled messages to rewrite mode and uses fallback dedupe keys', async () => {
		const calls: RunnerCall[] = [];
		const handledInputs: OpenCodeMessageDedupeInput[] = [];
		const shouldHandleMessage: ShouldHandleMessage = (input): boolean => {
			handledInputs.push(input);
			return true;
		};
		const handler: OpenCodeChatMessageHandler = createOpenCodeChatMessageHandler(
			normalizeOpenCodeOptions({ mode: 'rewrite' }),
			shouldHandleRootSession,
			shouldHandleMessage,
			promptRunners(calls),
			(): string => 'fallback_1',
		);

		await handler(chatMessageInput({ messageID: undefined }), chatMessageOutput());

		assert.equal(calls.length, 1);
		assert.equal(calls[0].mode, 'rewrite');
		assert.deepEqual(calls[0].coreInput, {
			conversationId: 'ses_123',
			model: { providerID: 'anthropic', modelID: 'claude' },
		});
		assert.deepEqual(handledInputs, [
			{
				conversationId: 'ses_123',
				dedupeKey: 'fallback_1',
			},
		]);
	});

	void test('does not run prompt runners when the message should be skipped', async () => {
		const calls: RunnerCall[] = [];
		const handledInputs: OpenCodeMessageDedupeInput[] = [];
		const shouldHandleMessage: ShouldHandleMessage = (input): boolean => {
			handledInputs.push(input);
			return false;
		};
		const handler: OpenCodeChatMessageHandler = createOpenCodeChatMessageHandler(
			normalizeOpenCodeOptions(),
			shouldHandleRootSession,
			shouldHandleMessage,
			promptRunners(calls),
			(): string => 'fallback_1',
		);

		await handler(chatMessageInput(), chatMessageOutput());

		assert.equal(handledInputs.length, 1);
		assert.deepEqual(calls, []);
	});

	void test('does not run message dedupe or prompt runners when the session should be skipped', async () => {
		const calls: RunnerCall[] = [];
		const handledInputs: OpenCodeMessageDedupeInput[] = [];
		const shouldHandleMessage: ShouldHandleMessage = (input): boolean => {
			handledInputs.push(input);
			return true;
		};
		const handler: OpenCodeChatMessageHandler = createOpenCodeChatMessageHandler(
			normalizeOpenCodeOptions(),
			(): Promise<boolean> => Promise.resolve(false),
			shouldHandleMessage,
			promptRunners(calls),
			(): string => 'fallback_1',
		);

		await handler(chatMessageInput(), chatMessageOutput());

		assert.deepEqual(handledInputs, []);
		assert.deepEqual(calls, []);
	});
});
