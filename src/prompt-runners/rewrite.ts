import {
	type ChatMessageInput,
	type ChatMessageOutput,
	type PolisherResult,
	type WriteLog,
} from 'english-prompt-polisher';

import { handlePromptRewrite } from '../prompt-rewrite.ts';
import type { OpenCodePromptRunners, RunCheckPrompt } from '../prompt-runners.ts';
import type { OpenCodeChatMessageInput, OpenCodeOptions } from '../types.ts';

import { runPromptRunnerSafely } from './logging.ts';

export function createRewriteRunner(
	options: OpenCodeOptions,
	runCheckPrompt: RunCheckPrompt,
	writeLog: WriteLog,
): OpenCodePromptRunners['rewrite'] {
	const runPromptRewrite = async (
		input: OpenCodeChatMessageInput,
		coreInput: ChatMessageInput,
		output: ChatMessageOutput,
	): Promise<void> => {
		await runPromptRunnerSafely(writeLog, input, 'Failed to rewrite prompt', async (): Promise<void> => {
			await handlePromptRewrite(coreInput, output, options, {
				checkPrompt: async (checkerInput, _checkerOptions, prompt): Promise<PolisherResult> => {
					return await runCheckPrompt(checkerInput, prompt);
				},
			});
		});
	};

	return runPromptRewrite;
}
