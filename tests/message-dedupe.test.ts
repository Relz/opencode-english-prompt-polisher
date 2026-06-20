import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import {
	createFallbackDedupeKeyGenerator,
	createShouldHandleMessage,
	type OpenCodeMessageDedupeInput,
} from '../src/message-dedupe.ts';

void suite('createShouldHandleMessage', () => {
	void test('creates distinct fallback dedupe keys', () => {
		const nextDedupeKey: ReturnType<typeof createFallbackDedupeKeyGenerator> = createFallbackDedupeKeyGenerator();

		const firstKey: string = nextDedupeKey();
		const secondKey: string = nextDedupeKey();

		assert.notEqual(firstKey, '');
		assert.notEqual(secondKey, '');
		assert.notEqual(firstKey, secondKey);
	});

	void test('skips duplicate message ids', () => {
		const shouldHandleMessage: ReturnType<typeof createShouldHandleMessage> = createShouldHandleMessage();
		const firstInput: OpenCodeMessageDedupeInput = { conversationId: 'conversation_123', messageId: 'message_456' };
		const secondInput: OpenCodeMessageDedupeInput = {
			conversationId: 'conversation_123',
			messageId: 'message_456',
		};

		const firstResult: boolean = shouldHandleMessage(firstInput);
		const secondResult: boolean = shouldHandleMessage(secondInput);

		assert.equal(firstResult, true);
		assert.equal(secondResult, false);
	});

	void test('handles different message ids independently', () => {
		const shouldHandleMessage: ReturnType<typeof createShouldHandleMessage> = createShouldHandleMessage();
		const firstInput: OpenCodeMessageDedupeInput = { conversationId: 'conversation_123', messageId: 'message_456' };
		const secondInput: OpenCodeMessageDedupeInput = {
			conversationId: 'conversation_123',
			messageId: 'message_789',
		};

		const firstResult: boolean = shouldHandleMessage(firstInput);
		const secondResult: boolean = shouldHandleMessage(secondInput);

		assert.equal(firstResult, true);
		assert.equal(secondResult, true);
	});

	void test('dedupes globally unique message ids across conversations', () => {
		const shouldHandleMessage: ReturnType<typeof createShouldHandleMessage> = createShouldHandleMessage();
		const firstInput: OpenCodeMessageDedupeInput = { conversationId: 'conversation_123', messageId: 'message_456' };
		const secondInput: OpenCodeMessageDedupeInput = {
			conversationId: 'conversation_789',
			messageId: 'message_456',
		};

		const firstResult: boolean = shouldHandleMessage(firstInput);
		const secondResult: boolean = shouldHandleMessage(secondInput);

		assert.equal(firstResult, true);
		assert.equal(secondResult, false);
	});

	void test('prefers message id over dedupe key', () => {
		const shouldHandleMessage: ReturnType<typeof createShouldHandleMessage> = createShouldHandleMessage();
		const firstInput: OpenCodeMessageDedupeInput = {
			conversationId: 'conversation_123',
			messageId: 'message_456',
			dedupeKey: 'turn_1',
		};
		const secondInput: OpenCodeMessageDedupeInput = {
			conversationId: 'conversation_123',
			messageId: 'message_456',
			dedupeKey: 'turn_2',
		};

		const firstResult: boolean = shouldHandleMessage(firstInput);
		const secondResult: boolean = shouldHandleMessage(secondInput);

		assert.equal(firstResult, true);
		assert.equal(secondResult, false);
	});

	void test('falls back to stable dedupe keys when message id is missing', () => {
		const shouldHandleMessage: ReturnType<typeof createShouldHandleMessage> = createShouldHandleMessage();
		const firstInput: OpenCodeMessageDedupeInput = { conversationId: 'conversation_123', dedupeKey: 'turn_1' };
		const secondInput: OpenCodeMessageDedupeInput = { conversationId: 'conversation_123', dedupeKey: 'turn_1' };
		const thirdInput: OpenCodeMessageDedupeInput = { conversationId: 'conversation_123', dedupeKey: 'turn_2' };

		const firstResult: boolean = shouldHandleMessage(firstInput);
		const secondResult: boolean = shouldHandleMessage(secondInput);
		const thirdResult: boolean = shouldHandleMessage(thirdInput);

		assert.equal(firstResult, true);
		assert.equal(secondResult, false);
		assert.equal(thirdResult, true);
	});

	void test('keeps fallback dedupe keys separate by conversation', () => {
		const shouldHandleMessage: ReturnType<typeof createShouldHandleMessage> = createShouldHandleMessage();
		const firstInput: OpenCodeMessageDedupeInput = { conversationId: 'conversation_123', dedupeKey: 'turn_1' };
		const secondInput: OpenCodeMessageDedupeInput = { conversationId: 'conversation_789', dedupeKey: 'turn_1' };

		const firstResult: boolean = shouldHandleMessage(firstInput);
		const secondResult: boolean = shouldHandleMessage(secondInput);

		assert.equal(firstResult, true);
		assert.equal(secondResult, true);
	});

	void test('treats empty message ids as missing', () => {
		const shouldHandleMessage: ReturnType<typeof createShouldHandleMessage> = createShouldHandleMessage();
		const firstInput: OpenCodeMessageDedupeInput = {
			conversationId: 'conversation_123',
			messageId: '',
			dedupeKey: 'turn_1',
		};
		const secondInput: OpenCodeMessageDedupeInput = {
			conversationId: 'conversation_123',
			messageId: '',
			dedupeKey: 'turn_1',
		};

		const firstResult: boolean = shouldHandleMessage(firstInput);
		const secondResult: boolean = shouldHandleMessage(secondInput);

		assert.equal(firstResult, true);
		assert.equal(secondResult, false);
	});

	void test('uses conversation-level last-resort dedupe when no stable message key is present', () => {
		const shouldHandleMessage: ReturnType<typeof createShouldHandleMessage> = createShouldHandleMessage();
		const firstInput: OpenCodeMessageDedupeInput = { conversationId: 'conversation_123' };
		const secondInput: OpenCodeMessageDedupeInput = { conversationId: 'conversation_123', dedupeKey: '' };
		const thirdInput: OpenCodeMessageDedupeInput = { conversationId: 'conversation_789' };

		const firstResult: boolean = shouldHandleMessage(firstInput);
		const secondResult: boolean = shouldHandleMessage(secondInput);
		const thirdResult: boolean = shouldHandleMessage(thirdInput);

		assert.equal(firstResult, true);
		assert.equal(secondResult, false);
		assert.equal(thirdResult, true);
	});

	void test('keeps dedupe state per handler', () => {
		const firstShouldHandleMessage: ReturnType<typeof createShouldHandleMessage> = createShouldHandleMessage();
		const secondShouldHandleMessage: ReturnType<typeof createShouldHandleMessage> = createShouldHandleMessage();
		const input: OpenCodeMessageDedupeInput = { conversationId: 'conversation_123', messageId: 'message_456' };

		const firstResult: boolean = firstShouldHandleMessage(input);
		const secondResult: boolean = secondShouldHandleMessage(input);

		assert.equal(firstResult, true);
		assert.equal(secondResult, true);
	});
});
