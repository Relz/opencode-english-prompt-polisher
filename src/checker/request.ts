import type { SessionPromptData, TextPartInput } from '@opencode-ai/sdk';
import { buildCheckerPrompt, type ChatMessageInput } from 'english-prompt-polisher';

import type { OpenCodeOptions } from '../types.ts';

import { checkerRequestPolicy, type CheckerRequestPolicy } from './policy.ts';

type SessionPromptBody = NonNullable<SessionPromptData['body']>;

export type CheckerRequestBody = Omit<SessionPromptBody, 'agent' | 'parts' | 'system' | 'tools'> & {
	agent: string;
	system: string;
	tools: Record<string, boolean>;
	parts: [TextPartInput];
};

export function buildCheckerRequestBody(
	input: ChatMessageInput,
	options: OpenCodeOptions,
	prompt: string,
	tools: CheckerRequestBody['tools'],
): CheckerRequestBody {
	const policy: CheckerRequestPolicy = checkerRequestPolicy(input, options);
	return {
		agent: policy.agent,
		model: policy.model,
		tools,
		system: policy.system,
		parts: [{ type: 'text', text: buildCheckerPrompt(prompt) }],
	};
}
