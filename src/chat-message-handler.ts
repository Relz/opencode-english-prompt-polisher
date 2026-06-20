import type { Hooks } from '@opencode-ai/plugin';
import type { ChatMessageInput } from 'english-prompt-polisher';

import { toCoreChatMessageInput, toMessageDedupeInput } from './chat-input.ts';
import type { NextDedupeKey, OpenCodeMessageDedupeInput, ShouldHandleMessage } from './message-dedupe.ts';
import { modeOption } from './options.ts';
import { dispatchPromptMode } from './prompt-mode-message-handler.ts';
import type { OpenCodePromptRunners } from './prompt-runners.ts';
import type { ShouldHandleSession } from './session-filter.ts';
import type { OpenCodeOptions } from './types.ts';

export type OpenCodeChatMessageHandler = NonNullable<Hooks['chat.message']>;

export function createOpenCodeChatMessageHandler(
	options: OpenCodeOptions,
	shouldHandleSession: ShouldHandleSession,
	shouldHandleMessage: ShouldHandleMessage,
	promptRunners: OpenCodePromptRunners,
	nextFallbackDedupeKey: NextDedupeKey,
): OpenCodeChatMessageHandler {
	return async (input, output): Promise<void> => {
		if (!(await shouldHandleSession(input.sessionID))) {
			return;
		}

		const dedupeInput: OpenCodeMessageDedupeInput = toMessageDedupeInput(
			input,
			input.messageID === undefined ? nextFallbackDedupeKey() : undefined,
		);
		if (!shouldHandleMessage(dedupeInput)) {
			return;
		}

		const coreInput: ChatMessageInput = toCoreChatMessageInput(input);
		await dispatchPromptMode(modeOption(options), input, coreInput, output, promptRunners);
	};
}
