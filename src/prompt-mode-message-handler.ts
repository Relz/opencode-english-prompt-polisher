import type { ChatMessageInput } from 'english-prompt-polisher';

import type { OpenCodeMessageDedupeInput, ShouldHandleMessage } from './message-dedupe.ts';
import type { PromptMode } from './types.ts';

export type PromptModeRunners<TInput, TOutput> = {
	propose: (input: TInput, coreInput: ChatMessageInput, output: TOutput) => void;
	rewrite: (input: TInput, coreInput: ChatMessageInput, output: TOutput) => Promise<void>;
};

export type ToCoreChatMessageInput<TInput> = (input: TInput) => ChatMessageInput;
export type ToMessageDedupeInput<TInput> = (input: TInput) => OpenCodeMessageDedupeInput;

export type PromptModeMessageHandler<TInput, TOutput> = (input: TInput, output: TOutput) => Promise<void>;

export async function dispatchPromptMode<TInput, TOutput>(
	mode: PromptMode,
	input: TInput,
	coreInput: ChatMessageInput,
	output: TOutput,
	promptRunners: PromptModeRunners<TInput, TOutput>,
): Promise<void> {
	if (mode === 'rewrite') {
		await promptRunners.rewrite(input, coreInput, output);
		return;
	}

	promptRunners.propose(input, coreInput, output);
}

export function createPromptModeMessageHandler<TInput, TOutput>(
	mode: PromptMode,
	toCoreInput: ToCoreChatMessageInput<TInput>,
	toDedupeInput: ToMessageDedupeInput<TInput>,
	shouldHandleMessage: ShouldHandleMessage,
	promptRunners: PromptModeRunners<TInput, TOutput>,
): PromptModeMessageHandler<TInput, TOutput> {
	return async (input: TInput, output: TOutput): Promise<void> => {
		if (!shouldHandleMessage(toDedupeInput(input))) {
			return;
		}

		const coreInput: ChatMessageInput = toCoreInput(input);
		await dispatchPromptMode(mode, input, coreInput, output, promptRunners);
	};
}
