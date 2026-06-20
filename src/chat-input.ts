import type { ChatMessageInput } from 'english-prompt-polisher';

import type { OpenCodeMessageDedupeInput } from './message-dedupe.ts';
import type { OpenCodeChatMessageInput } from './types.ts';

export function toCoreChatMessageInput(input: OpenCodeChatMessageInput): ChatMessageInput {
	const result: ChatMessageInput = {
		conversationId: input.sessionID,
	};

	if (input.messageID !== undefined) {
		result.messageId = input.messageID;
	}
	if (input.model !== undefined) {
		result.model = input.model;
	}

	return result;
}

export function toMessageDedupeInput(input: OpenCodeChatMessageInput, dedupeKey?: string): OpenCodeMessageDedupeInput {
	const result: OpenCodeMessageDedupeInput = {
		conversationId: input.sessionID,
	};

	if (input.messageID !== undefined) {
		result.messageId = input.messageID;
	}
	if (dedupeKey !== undefined) {
		result.dedupeKey = dedupeKey;
	}

	return result;
}
