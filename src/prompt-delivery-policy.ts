import type { PreparedPrompt, PromptHandlingResult } from './prompt-task.ts';
import type { PromptMode } from './types.ts';

export type PromptDeliveryPolicy = {
	// Whether losing the last pending admission cancels shared execution.
	cancelWhenUnobserved: boolean;
	// Delivery may finish admission early; run must await all execution and output.
	run: (
		execute: PreparedPrompt,
		signal: AbortSignal,
		deliver: (result: PromptHandlingResult | undefined) => void,
	) => Promise<void>;
};

export function createPromptDeliveryPolicy(mode: PromptMode): PromptDeliveryPolicy {
	if (mode === 'rewrite') {
		return {
			cancelWhenUnobserved: true,
			run: async (execute, _signal, deliver): Promise<void> => {
				deliver(await execute());
			},
		};
	}

	return {
		cancelWhenUnobserved: false,
		run: async (execute, signal, deliver): Promise<void> => {
			// Admit after preparation, but defer all execution, including model lookup and writes.
			deliver(undefined);
			await new Promise<void>((resolve): void => {
				setTimeout(resolve, 0);
			});
			signal.throwIfAborted();
			await execute();
		},
	};
}
