import {
	handlePromptProposal,
	type ChatMessageInput,
	type ChatMessageOutput,
	type PolisherResult,
	type WriteLog,
} from 'english-prompt-polisher';

import type { RunCheckPrompt } from '../prompt-runners.ts';
import type { OpenCodeChatMessageInput, OpenCodeOptions } from '../types.ts';

import { runPromptRunnerSafely } from './logging.ts';

export type RunPromptProposal = (
	input: OpenCodeChatMessageInput,
	coreInput: ChatMessageInput,
	output: ChatMessageOutput,
) => Promise<void>;

export function createPromptProposalExecutor(
	options: OpenCodeOptions,
	runCheckPrompt: RunCheckPrompt,
	writeLog: WriteLog,
): RunPromptProposal {
	const { mode, ...proposalOptions } = options;
	void mode;

	return async (
		input: OpenCodeChatMessageInput,
		coreInput: ChatMessageInput,
		output: ChatMessageOutput,
	): Promise<void> => {
		await runPromptRunnerSafely(writeLog, input, 'Failed to polish prompt', async (): Promise<void> => {
			await handlePromptProposal(coreInput, output, proposalOptions, {
				checkPrompt: async (checkerInput, _checkerOptions, prompt): Promise<PolisherResult> => {
					return await runCheckPrompt(checkerInput, prompt);
				},
				log: writeLog,
			});
		});
	};
}
