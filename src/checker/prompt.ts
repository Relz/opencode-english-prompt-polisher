import type { SessionPromptData } from '@opencode-ai/sdk';
import {
	parseCheckerResult,
	type ChatMessageInput,
	type ChatParts,
	type PolisherResult,
} from 'english-prompt-polisher';

import type { OpenCodeOptions } from '../types.ts';

import { queryForDirectory } from './query.ts';
import { buildCheckerRequestBody, type CheckerRequestBody } from './request.ts';

type ClientResult<T> = Promise<{ data: T | undefined }>;
type SessionPromptResultData = { parts?: ChatParts };
type SessionPromptOptions = Omit<SessionPromptData, 'body' | 'url'> & { body: CheckerRequestBody };

export type CheckerPromptClient = {
	session: {
		prompt: (options: SessionPromptOptions) => ClientResult<SessionPromptResultData>;
	};
};

type PromptCheckerSessionResult = Awaited<ReturnType<CheckerPromptClient['session']['prompt']>>;

function checkerResultParts(result: PromptCheckerSessionResult): ChatParts {
	return result.data?.parts ?? [];
}

async function promptCheckerSession(
	client: CheckerPromptClient,
	sessionID: string,
	input: ChatMessageInput,
	options: OpenCodeOptions,
	prompt: string,
	tools: CheckerRequestBody['tools'],
	directory?: string,
): Promise<ChatParts> {
	const query: ReturnType<typeof queryForDirectory> = queryForDirectory(directory);
	const result: PromptCheckerSessionResult = await client.session.prompt({
		path: { id: sessionID },
		body: buildCheckerRequestBody(input, options, prompt, tools),
		...(query === undefined ? {} : { query }),
	});

	return checkerResultParts(result);
}

export async function runCheckerPrompt(
	client: CheckerPromptClient,
	sessionID: string,
	input: ChatMessageInput,
	options: OpenCodeOptions,
	prompt: string,
	tools: CheckerRequestBody['tools'],
	directory?: string,
): Promise<PolisherResult> {
	const parts: ChatParts = await promptCheckerSession(client, sessionID, input, options, prompt, tools, directory);
	return parseCheckerResult(parts);
}
