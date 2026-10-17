import type { Plugin } from '@opencode/plugin';

import { createCheckerService, type CheckerService } from './checker/index.ts';
import { createCheckerModelResolver, type CheckerModelResolver } from './checker/model-resolver.ts';
import { normalizeOpenCodeOptions, modeOption } from './options.ts';
import { createPendingWorkTracker, type PendingWorkTracker } from './pending-work-tracker.ts';
import { createPromptDeliveryPolicy } from './prompt-delivery-policy.ts';
import { createPromptHook } from './prompt-hook.ts';
import { createPromptProcessor, type PromptProcessor } from './prompt-processor.ts';
import { createPromptTaskCoordinator, type PromptTaskCoordinator } from './prompt-task-coordinator.ts';
import type { OpenCodeContext } from './server-context.ts';
import { writeStderrLog as writeLog } from './stderr-log.ts';
import type { OpenCodeOptions } from './types.ts';

export type { OpenCodeContext } from './server-context.ts';

export async function setup(ctx: OpenCodeContext): Promise<Plugin.Cleanup> {
	const options: OpenCodeOptions = normalizeOpenCodeOptions(ctx.options);
	const pending: PendingWorkTracker = createPendingWorkTracker();
	const checker: CheckerService = createCheckerService(ctx, options, pending.track);
	const resolveCheckerModel: CheckerModelResolver = createCheckerModelResolver(ctx, options);
	const processor: PromptProcessor = createPromptProcessor(
		ctx,
		options,
		checker.check,
		writeLog,
		resolveCheckerModel,
	);
	const coordinator: PromptTaskCoordinator = createPromptTaskCoordinator(
		createPromptDeliveryPolicy(modeOption(options)),
		processor.prepare,
		pending,
		writeLog,
	);

	await ctx.session.hook('generate', checker.handleGenerate);

	await ctx.session.hook('prompt', createPromptHook(coordinator));

	return (): Promise<void> => {
		coordinator.stop();
		return pending.drain();
	};
}
