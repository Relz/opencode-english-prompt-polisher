import type { SessionPrompt } from '@opencode/plugin/promise/session';
import { isInternalPrompt } from 'english-prompt-polisher';

import type { PromptTaskCoordinator } from './prompt-task-coordinator.ts';

export type PromptHook = (event: SessionPrompt, admissionSignal: AbortSignal) => Promise<void>;

function clearMentions(event: SessionPrompt): void {
	for (const attachment of [
		...(event.prompt.files ?? []),
		...(event.prompt.agents ?? []),
		...(event.prompt.skills ?? []),
	]) {
		delete attachment.mention;
	}
}

export function createPromptHook(coordinator: Pick<PromptTaskCoordinator, 'admit' | 'isStopped'>): PromptHook {
	return async (event: SessionPrompt, admissionSignal: AbortSignal): Promise<void> => {
		if (coordinator.isStopped() || event.prompt.text.trim().length === 0 || isInternalPrompt(event.prompt.text)) {
			return;
		}
		const originalText: string = event.prompt.text;
		const text: string | undefined = await coordinator.admit(
			{ sessionID: event.sessionID, messageID: event.messageID, text: originalText },
			admissionSignal,
		);
		// Cancellation can also arrive between coordination and hook delivery.
		if (!admissionSignal.aborted && !coordinator.isStopped() && text !== undefined && text !== originalText) {
			event.prompt.text = text;
			clearMentions(event);
		}
	};
}
