import {
	CHECKER_SYSTEM_PROMPT,
	resolveCheckerModel,
	type ChatMessageInput,
	type ChatModel,
} from 'english-prompt-polisher';

import { checkerOptions } from '../options.ts';
import type { OpenCodeCheckerOptions, OpenCodeOptions } from '../types.ts';

export const DEFAULT_CHECKER_AGENT: string = 'general';

export type CheckerRequestPolicy = {
	agent: string;
	model?: ChatModel;
	system: string;
};

export function checkerRequestPolicy(input: ChatMessageInput, options: OpenCodeOptions): CheckerRequestPolicy {
	const checker: OpenCodeCheckerOptions = checkerOptions(options);
	return {
		agent: checker.agent ?? DEFAULT_CHECKER_AGENT,
		model: resolveCheckerModel(input.model, checker.model),
		system: CHECKER_SYSTEM_PROMPT,
	};
}
