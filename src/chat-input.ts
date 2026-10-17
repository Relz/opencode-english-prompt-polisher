import type { ChatMessageInput } from 'english-prompt-polisher';

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
