import {
	type ChatMessageInput,
	type ChatMessageOutput,
	type PolisherResult,
	type WriteLog,
} from 'english-prompt-polisher';

import { checkPrompt, type CheckerClient } from './checker/index.ts';
import { createOpenCodeLog, type OpenCodeLogClient } from './log.ts';
import type { PromptModeRunners } from './prompt-mode-message-handler.ts';
import { createBackgroundProposalRunner } from './prompt-runners/proposal-background.ts';
import { createPromptProposalExecutor } from './prompt-runners/proposal.ts';
import { createRewriteRunner } from './prompt-runners/rewrite.ts';
import type { SessionLookupClient } from './session-filter.ts';
import type { OpenCodeChatMessageInput, OpenCodeOptions } from './types.ts';

export type OpenCodeClient = CheckerClient & OpenCodeLogClient & SessionLookupClient;

export type OpenCodePromptRunners = PromptModeRunners<OpenCodeChatMessageInput, ChatMessageOutput>;

export type RunCheckPrompt = (coreInput: ChatMessageInput, prompt: string) => Promise<PolisherResult>;

export function createOpenCodePromptRunners(
	client: OpenCodeClient,
	options: OpenCodeOptions,
	directory?: string,
): OpenCodePromptRunners {
	const writeLog: WriteLog = createOpenCodeLog(client);

	const runCheckPrompt = async (coreInput: ChatMessageInput, prompt: string): Promise<PolisherResult> => {
		return await checkPrompt(client, coreInput, options, prompt, directory);
	};

	return {
		propose: createBackgroundProposalRunner(createPromptProposalExecutor(options, runCheckPrompt, writeLog)),
		rewrite: createRewriteRunner(options, runCheckPrompt, writeLog),
	};
}
