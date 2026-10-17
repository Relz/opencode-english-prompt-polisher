import { formatUnknownError, type WriteLog } from 'english-prompt-polisher';

import type { OpenCodeChatMessageInput } from '../types.ts';

export type PromptRunnerAction<TResult> = () => Promise<TResult>;

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

export async function runPromptRunnerSafely<TResult>(
	writeLog: WriteLog,
	input: OpenCodeChatMessageInput,
	failureMessage: string,
	run: PromptRunnerAction<TResult>,
): Promise<TResult | undefined> {
	try {
		return await run();
	} catch (error) {
		await logPromptRunnerFailure(writeLog, input, failureMessage, error);
	}
}
