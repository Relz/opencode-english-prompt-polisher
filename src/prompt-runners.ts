import { type ChatMessageInput, type PolisherResult, type WriteLog } from 'english-prompt-polisher';

import { createPromptProposalExecutor, type RunPromptProposal } from './prompt-runners/proposal.ts';
import { createRewriteRunner, type RunPromptRewrite } from './prompt-runners/rewrite.ts';
import type { OpenCodeOptions } from './types.ts';

export type OpenCodePromptRunners = {
	propose: RunPromptProposal;
	rewrite: RunPromptRewrite;
};

export type RunCheckPrompt = (coreInput: ChatMessageInput, prompt: string) => Promise<PolisherResult>;

export function createPromptRunners(
	options: OpenCodeOptions,
	runCheckPrompt: RunCheckPrompt,
	writeLog: WriteLog,
	signal?: AbortSignal,
): OpenCodePromptRunners {
	return {
		propose: createPromptProposalExecutor(options, runCheckPrompt, writeLog, signal),
		rewrite: createRewriteRunner(options, runCheckPrompt, writeLog),
	};
}
