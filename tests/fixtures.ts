import type { ChatMessageInput, ChatMessageOutput, ChatPart, ChatParts } from 'english-prompt-polisher';

type TextChatPart = ChatPart & {
	type: 'text';
	text: string;
};

const defaultModel: NonNullable<ChatMessageInput['model']> = { providerID: 'anthropic', modelID: 'claude' };

export function chatInput(overrides: Partial<ChatMessageInput> = {}): ChatMessageInput {
	const input: ChatMessageInput = {
		conversationId: 'ses_123',
		messageId: 'msg_456',
		model: defaultModel,
		...overrides,
	};
	return input;
}

export function textPart(text: string, overrides: Partial<TextChatPart> = {}): TextChatPart {
	const part: TextChatPart = {
		id: 'prt_123',
		conversationId: 'ses_123',
		messageId: 'msg_456',
		type: 'text',
		text,
		...overrides,
	};
	return part;
}

type TestUserMessage = {
	id: string;
	conversationId: string;
	role: 'user';
	time: { created: number };
	agent: string;
	model: NonNullable<ChatMessageInput['model']>;
};

export function userMessage(overrides: Partial<TestUserMessage> = {}): TestUserMessage {
	const message: TestUserMessage = {
		id: 'msg_456',
		conversationId: 'ses_123',
		role: 'user',
		time: { created: 0 },
		agent: 'general',
		model: defaultModel,
		...overrides,
	};
	return message;
}

export function chatOutput(parts: ChatParts): ChatMessageOutput {
	const output: ChatMessageOutput = {
		message: userMessage(),
		parts,
	};
	return output;
}
