import type { ChatMessageInput, PolisherResult } from 'english-prompt-polisher';

import type { OpenCodeOptions } from '../types.ts';

import { runCheckerPrompt, type CheckerPromptClient } from './prompt.ts';
import type { CheckerRequestBody } from './request.ts';
import type { CheckerSessionClient } from './session.ts';
import type { CheckerToolClient } from './tools.ts';
import { checkerWorkflowPlan } from './workflow-plan.ts';
import { runCheckerWorkflow } from './workflow.ts';

export type CheckerClient = CheckerSessionClient & CheckerToolClient & CheckerPromptClient;

type Client = CheckerClient;

export async function checkPrompt(
	client: Client,
	input: ChatMessageInput,
	options: OpenCodeOptions,
	prompt: string,
	directory?: string,
): Promise<PolisherResult> {
	return await runCheckerWorkflow(
		client,
		checkerWorkflowPlan(input, options),
		async (sessionID, tools: CheckerRequestBody['tools']) => {
			return await runCheckerPrompt(client, sessionID, input, options, prompt, tools, directory);
		},
		directory,
	);
}
