import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import type { ChatMessageInput } from 'english-prompt-polisher';

import type { OpenCodeMessageDedupeInput } from '../src/message-dedupe.ts';
import {
	createPromptModeMessageHandler,
	type PromptModeMessageHandler,
	type PromptModeRunners,
} from '../src/prompt-mode-message-handler.ts';

type AdapterInput = { id: string };
type AdapterOutput = { value: string };
type RunnerCall = {
	mode: 'proposal' | 'rewrite';
	input: AdapterInput;
	coreInput: ChatMessageInput;
	output: AdapterOutput;
};

const adapterInput: AdapterInput = { id: 'message_456' };
const adapterOutput: AdapterOutput = { value: 'prompt' };
const coreInput: ChatMessageInput = { conversationId: 'conversation_123', messageId: 'message_456' };
const dedupeInput: OpenCodeMessageDedupeInput = { conversationId: 'conversation_123', messageId: 'message_456' };

function promptRunners(calls: RunnerCall[]): PromptModeRunners<AdapterInput, AdapterOutput> {
	return {
		propose: (input, inputCoreInput, output): void => {
			calls.push({ mode: 'proposal', input, coreInput: inputCoreInput, output });
		},
		rewrite: (input, inputCoreInput, output): Promise<void> => {
			calls.push({ mode: 'rewrite', input, coreInput: inputCoreInput, output });
			return Promise.resolve();
		},
	};
}

void suite('createPromptModeMessageHandler', () => {
	void test('routes handled messages to proposal mode', async () => {
		const calls: RunnerCall[] = [];
		const handler: PromptModeMessageHandler<AdapterInput, AdapterOutput> = createPromptModeMessageHandler(
			'proposal',
			(): ChatMessageInput => coreInput,
			(): OpenCodeMessageDedupeInput => dedupeInput,
			(): boolean => true,
			promptRunners(calls),
		);

		await handler(adapterInput, adapterOutput);

		assert.deepEqual(calls, [{ mode: 'proposal', input: adapterInput, coreInput, output: adapterOutput }]);
	});

	void test('routes handled messages to rewrite mode', async () => {
		const calls: RunnerCall[] = [];
		const handler: PromptModeMessageHandler<AdapterInput, AdapterOutput> = createPromptModeMessageHandler(
			'rewrite',
			(): ChatMessageInput => coreInput,
			(): OpenCodeMessageDedupeInput => dedupeInput,
			(): boolean => true,
			promptRunners(calls),
		);

		await handler(adapterInput, adapterOutput);

		assert.deepEqual(calls, [{ mode: 'rewrite', input: adapterInput, coreInput, output: adapterOutput }]);
	});

	void test('does not run prompt runners when the message should be skipped', async () => {
		const calls: RunnerCall[] = [];
		const handledInputs: OpenCodeMessageDedupeInput[] = [];
		const handler: PromptModeMessageHandler<AdapterInput, AdapterOutput> = createPromptModeMessageHandler(
			'proposal',
			(): ChatMessageInput => coreInput,
			(): OpenCodeMessageDedupeInput => dedupeInput,
			(input): boolean => {
				handledInputs.push(input);
				return false;
			},
			promptRunners(calls),
		);

		await handler(adapterInput, adapterOutput);

		assert.deepEqual(handledInputs, [dedupeInput]);
		assert.deepEqual(calls, []);
	});
});
