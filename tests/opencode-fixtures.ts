import type { Hooks } from '@opencode-ai/plugin';

type ChatMessageHook = NonNullable<Hooks['chat.message']>;

export type ChatMessageHookInput = Parameters<ChatMessageHook>[0];
export type ChatMessageHookOutput = Parameters<ChatMessageHook>[1];
export type ChatMessageHookPart = ChatMessageHookOutput['parts'][number];
export type TextChatMessageHookPart = ChatMessageHookPart & { type: 'text'; text: string };

const defaultModel: NonNullable<ChatMessageHookInput['model']> = { providerID: 'anthropic', modelID: 'claude' };

export function chatMessageInput(overrides: Partial<ChatMessageHookInput> = {}): ChatMessageHookInput {
	return {
		sessionID: 'ses_123',
		messageID: 'msg_456',
		model: defaultModel,
		...overrides,
	};
}

export function textChatMessagePart(
	text: string,
	overrides: Partial<TextChatMessageHookPart> = {},
): TextChatMessageHookPart {
	return {
		id: 'prt_123',
		sessionID: 'ses_123',
		messageID: 'msg_456',
		type: 'text',
		text,
		...overrides,
	};
}

export function chatMessageOutput(
	parts: ChatMessageHookPart[] = [textChatMessagePart('Corrige esto')],
): ChatMessageHookOutput {
	return {
		message: {
			id: 'msg_456',
			sessionID: 'ses_123',
			role: 'user',
			time: { created: 0 },
			agent: 'general',
			model: defaultModel,
		},
		parts,
	};
}
