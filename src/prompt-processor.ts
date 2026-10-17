import type { ChatMessageInput, PolisherResult, WriteLog } from 'english-prompt-polisher';

import { toCoreChatMessageInput } from './chat-input.ts';
import type { CheckerService } from './checker/index.ts';
import type { CheckerModelResolver } from './checker/model-resolver.ts';
import { modeOption } from './options.ts';
import { createPromptRunners, type OpenCodePromptRunners } from './prompt-runners.ts';
import type { PreparePrompt, PreparedPrompt, PromptHandlingResult, PromptRequest } from './prompt-task.ts';
import type { OpenCodeContext } from './server-context.ts';
import type { OpenCodeChatMessageInput, OpenCodeOptions } from './types.ts';

export type PromptProcessor = {
	prepare: PreparePrompt;
};

export function createPromptProcessor(
	ctx: OpenCodeContext,
	options: OpenCodeOptions,
	check: CheckerService['check'],
	writeLog: WriteLog,
	resolveCheckerModel: CheckerModelResolver,
): PromptProcessor {
	async function preparePrompt(request: PromptRequest, signal: AbortSignal): Promise<PreparedPrompt | undefined> {
		signal.throwIfAborted();
		const requestSnapshot: PromptRequest = { ...request };
		const session: Awaited<ReturnType<OpenCodeContext['session']['get']>> = await ctx.session.get(
			{ sessionID: requestSnapshot.sessionID },
			{ signal },
		);
		signal.throwIfAborted();
		if (session.parentID !== undefined) {
			return;
		}
		return (): Promise<PromptHandlingResult> => runPrompt(requestSnapshot, session, signal);
	}

	async function runPrompt(
		request: PromptRequest,
		session: Awaited<ReturnType<OpenCodeContext['session']['get']>>,
		signal: AbortSignal,
	): Promise<PromptHandlingResult> {
		signal.throwIfAborted();
		const model: OpenCodeChatMessageInput['model'] = await resolveCheckerModel(session, signal);
		signal.throwIfAborted();
		const input: OpenCodeChatMessageInput = {
			sessionID: request.sessionID,
			messageID: request.messageID,
			model,
		};
		const runners: OpenCodePromptRunners = createPromptRunners(
			options,
			async (checkerInput, prompt): Promise<PolisherResult> => {
				const result: PolisherResult = await check(session.location, checkerInput, prompt, signal);
				// Cancellation may race with delivery of a completed checker result.
				signal.throwIfAborted();
				return result;
			},
			writeLog,
			signal,
		);
		const coreInput: ChatMessageInput = toCoreChatMessageInput(input);
		if (modeOption(options) === 'rewrite') {
			// Keep the text normalization previously performed by textFromParts.
			const text: string | undefined = (await runners.rewrite(input, coreInput, request.text.trim()))?.trim();
			return { text: text === request.text ? undefined : text };
		}
		await runners.propose(input, coreInput, { parts: [{ type: 'text', text: request.text }] });
		return {};
	}

	return {
		prepare: preparePrompt,
	};
}
