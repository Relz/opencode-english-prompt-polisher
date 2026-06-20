import { formatUnknownError, type WriteLog } from 'english-prompt-polisher';

import type { OpenCodeChatMessageInput } from '../types.ts';

export type PromptRunnerAction = () => Promise<void>;

function openCodePromptRunnerLogExtra(input: OpenCodeChatMessageInput): Record<string, unknown> {
	return {
		sessionID: input.sessionID,
		messageID: input.messageID,
	};
}

export async function logPromptRunnerFailure(
	writeLog: WriteLog,
	input: OpenCodeChatMessageInput,
	message: string,
	error: unknown,
): Promise<void> {
	await writeLog('warn', message, {
		...openCodePromptRunnerLogExtra(input),
		error: formatUnknownError(error),
	});
}

export async function runPromptRunnerSafely(
	writeLog: WriteLog,
	input: OpenCodeChatMessageInput,
	failureMessage: string,
	run: PromptRunnerAction,
): Promise<void> {
	try {
		await run();
	} catch (error) {
		await logPromptRunnerFailure(writeLog, input, failureMessage, error);
	}
}
