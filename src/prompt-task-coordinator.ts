import { formatUnknownError, type WriteLog } from 'english-prompt-polisher';

import type { PendingWorkRegistration } from './pending-work-tracker.ts';
import type { PromptDeliveryPolicy } from './prompt-delivery-policy.ts';
import type { PreparePrompt, PreparedPrompt, PromptHandlingResult, PromptRequest } from './prompt-task.ts';

type PromptTask = {
	result: PromiseWithResolvers<PromptHandlingResult | undefined>;
	controller: AbortController;
	signal: AbortSignal;
	admissions: number;
};

export type PromptTaskCoordinator = {
	admit: (request: PromptRequest, admissionSignal: AbortSignal) => Promise<string | undefined>;
	isStopped: () => boolean;
	stop: () => void;
};

export function createPromptTaskCoordinator(
	delivery: PromptDeliveryPolicy,
	preparePrompt: PreparePrompt,
	pending: PendingWorkRegistration,
	writeLog: WriteLog,
): PromptTaskCoordinator {
	const inFlight: Map<string, PromptTask> = new Map();
	const controller: AbortController = new AbortController();
	let disposed: boolean = false;

	async function logPromptFailure(request: PromptRequest, error: unknown): Promise<void> {
		await writeLog('warn', 'Failed to handle prompt', {
			sessionID: request.sessionID,
			error: formatUnknownError(error),
		});
	}

	function releaseReservation(key: string, task: PromptTask): void {
		if (inFlight.get(key) === task) {
			inFlight.delete(key);
		}
	}

	async function runPromptTask(key: string, request: PromptRequest, task: PromptTask): Promise<void> {
		try {
			task.signal.throwIfAborted();
			const execute: PreparedPrompt | undefined = await preparePrompt(request, task.signal);
			task.signal.throwIfAborted();
			if (execute === undefined) {
				return;
			}
			await delivery.run(execute, task.signal, task.result.resolve);
		} catch (error) {
			await logPromptFailure(request, error);
		} finally {
			releaseReservation(key, task);
			task.result.resolve(undefined);
		}
	}

	async function admit(request: PromptRequest, admissionSignal: AbortSignal): Promise<string | undefined> {
		if (disposed) {
			return;
		}
		admissionSignal.throwIfAborted();
		const requestSnapshot: PromptRequest = { ...request };
		const key: string = JSON.stringify([
			requestSnapshot.sessionID,
			requestSnapshot.messageID,
			requestSnapshot.text,
		]);
		let task: PromptTask | undefined = inFlight.get(key);
		if (task === undefined) {
			const taskController: AbortController = new AbortController();
			const signal: AbortSignal = AbortSignal.any([controller.signal, taskController.signal]);
			// Reserve before processing starts, including session/model lookups.
			task = {
				controller: taskController,
				signal,
				admissions: 0,
				result: Promise.withResolvers<PromptHandlingResult | undefined>(),
			};
			inFlight.set(key, task);
			const reservedTask: PromptTask = task;
			pending.track(
				Promise.resolve().then((): Promise<void> => runPromptTask(key, requestSnapshot, reservedTask)),
			);
		}
		const sharedTask: PromptTask = task;
		sharedTask.admissions++;
		let released: boolean = false;
		const release = (): void => {
			if (released) {
				return;
			}
			released = true;
			sharedTask.admissions--;
		};
		const cancelled: PromiseWithResolvers<undefined> = Promise.withResolvers<undefined>();
		const onAbort = (): void => {
			release();
			if (sharedTask.admissions === 0 && delivery.cancelWhenUnobserved) {
				sharedTask.controller.abort(admissionSignal.reason);
				// Retries must not join cancelled work, even if interruption is ignored.
				releaseReservation(key, sharedTask);
			}
			cancelled.resolve(undefined);
		};
		admissionSignal.addEventListener('abort', onAbort, { once: true });
		try {
			const result: PromptHandlingResult | undefined = await Promise.race([
				sharedTask.result.promise,
				cancelled.promise,
			]);
			if (!admissionSignal.aborted && !sharedTask.signal.aborted) {
				return result?.text;
			}
		} finally {
			admissionSignal.removeEventListener('abort', onAbort);
			release();
		}
	}

	return {
		admit,
		isStopped: (): boolean => disposed,
		stop: (): void => {
			if (disposed) {
				return;
			}
			disposed = true;
			controller.abort(new Error('Prompt polisher has been unloaded'));
		},
	};
}
