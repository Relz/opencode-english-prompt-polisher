import type { ChatMessageInput } from 'english-prompt-polisher';

import { checkerOptions } from '../options.ts';
import type { OpenCodeCheckerOptions, OpenCodeOptions } from '../types.ts';

export type CheckerWorkflowPlan = {
	deleteSession: boolean;
	parentSessionID: string;
};

export function checkerWorkflowPlan(input: ChatMessageInput, options: OpenCodeOptions): CheckerWorkflowPlan {
	const checker: OpenCodeCheckerOptions = checkerOptions(options);
	return {
		deleteSession: checker.deleteSession !== false,
		parentSessionID: input.conversationId,
	};
}
