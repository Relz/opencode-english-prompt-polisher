import type { Plugin } from '@opencode/plugin';
import type { SessionGenerate } from '@opencode/plugin/promise/session';
import {
	buildCheckerPrompt,
	parseCheckerResult,
	type ChatMessageInput,
	type PolisherResult,
} from 'english-prompt-polisher';

import type { PendingWorkRegistration } from '../pending-work-tracker.ts';
import type { OpenCodeOptions } from '../types.ts';

import { checkerRequestPolicy, type CheckerRequestPolicy } from './policy.ts';
import { withCheckerSession } from './session-lifecycle.ts';
import { checkerWorkflowPlan, type CheckerWorkflowPlan } from './workflow-plan.ts';

export type CheckerContext = {
	session: Pick<Plugin.Context['session'], 'generate' | 'remove'> & {
		create: (...args: Parameters<Plugin.Context['session']['create']>) => Promise<{ id: string }>;
	};
	location: { directory: string };
};

export type CheckerService = {
	check: (
		sourceLocation: { directory: string },
		input: ChatMessageInput,
		prompt: string,
		signal?: AbortSignal,
	) => Promise<PolisherResult>;
	handleGenerate: (event: SessionGenerate) => void;
};

export function createCheckerService(
	ctx: CheckerContext,
	options: OpenCodeOptions,
	registerPendingWork: PendingWorkRegistration['track'],
): CheckerService {
	const activeSessions: Map<string, CheckerRequestPolicy> = new Map();

	async function check(
		sourceLocation: { directory: string },
		input: ChatMessageInput,
		prompt: string,
		signal?: AbortSignal,
	): Promise<PolisherResult> {
		const policy: CheckerRequestPolicy = checkerRequestPolicy(input, options);
		const plan: CheckerWorkflowPlan = checkerWorkflowPlan(input, options);
		const result: Awaited<ReturnType<CheckerContext['session']['generate']>> = await withCheckerSession(
			{ session: ctx.session, registerPendingWork },
			{
				create: {
					title: 'English prompt polish check',
					parentID: plan.parentSessionID,
					agent: policy.agent,
					model:
						policy.model === undefined
							? undefined
							: {
									providerID: policy.model.providerID,
									id: policy.model.modelID,
									...(policy.model.variant === undefined ? {} : { variant: policy.model.variant }),
								},
					location: { directory: sourceLocation.directory },
				},
				deleteSession: plan.deleteSession,
				signal,
			},
			async (sessionID): Promise<Awaited<ReturnType<CheckerContext['session']['generate']>>> => {
				activeSessions.set(sessionID, policy);
				try {
					return await ctx.session.generate({ sessionID, prompt: buildCheckerPrompt(prompt) }, { signal });
				} finally {
					activeSessions.delete(sessionID);
				}
			},
		);
		return parseCheckerResult([{ type: 'text', text: result.text }]);
	}

	function handleGenerate(event: SessionGenerate): void {
		const policy: CheckerRequestPolicy | undefined = activeSessions.get(event.sessionID);
		if (policy === undefined) {
			return;
		}
		event.system = [{ type: 'text', text: policy.system }];
		event.tools = {};
	}

	return { check, handleGenerate };
}
