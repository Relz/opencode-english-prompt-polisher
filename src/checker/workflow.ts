import type { CheckerRequestBody } from './request.ts';
import { withCheckerSession, type CheckerSessionClient } from './session.ts';
import { disabledCheckerTools, type CheckerToolClient } from './tools.ts';
import type { CheckerWorkflowPlan } from './workflow-plan.ts';

export type CheckerWorkflowClient = CheckerSessionClient & CheckerToolClient;

export type RunInCheckerSession<T> = (sessionID: string, tools: CheckerRequestBody['tools']) => Promise<T>;

export async function runCheckerWorkflow<T>(
	client: CheckerWorkflowClient,
	plan: CheckerWorkflowPlan,
	run: RunInCheckerSession<T>,
	directory?: string,
): Promise<T> {
	const tools: CheckerRequestBody['tools'] = await disabledCheckerTools(client, directory);
	return await withCheckerSession(
		client,
		plan.deleteSession,
		(sessionID): Promise<T> => run(sessionID, tools),
		directory,
		plan.parentSessionID,
	);
}
