import {
	handlePromptRewrite,
	type ChatMessageInput,
	type PolisherResult,
	type PromptRewriteResult,
	type WriteLog,
} from 'english-prompt-polisher';

import type { RunCheckPrompt } from '../prompt-runners.ts';
import type { OpenCodeChatMessageInput, OpenCodeOptions } from '../types.ts';

import { runPromptRunnerSafely } from './logging.ts';

export type RunPromptRewrite = (
	input: OpenCodeChatMessageInput,
	coreInput: ChatMessageInput,
	prompt: string,
) => Promise<string | undefined>;

export function createRewriteRunner(
	options: OpenCodeOptions,
	runCheckPrompt: RunCheckPrompt,
	writeLog: WriteLog,
): RunPromptRewrite {
	const runPromptRewrite = async (
		input: OpenCodeChatMessageInput,
		coreInput: ChatMessageInput,
		prompt: string,
	): Promise<string | undefined> => {
		const result: PromptRewriteResult | undefined = await runPromptRunnerSafely(
			writeLog,
			input,
			'Failed to rewrite prompt',
			(): Promise<PromptRewriteResult> =>
				handlePromptRewrite(coreInput, prompt, options, {
					checkPrompt: async (checkerInput, _checkerOptions, prompt): Promise<PolisherResult> => {
						return await runCheckPrompt(checkerInput, prompt);
					},
				}),
		);
		return result?.status === 'rewritten' ? result.proposedPrompt : undefined;
	};

	return runPromptRewrite;
}
