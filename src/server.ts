import type { Hooks, PluginInput, PluginOptions } from '@opencode-ai/plugin';

import { createOpenCodeChatMessageHandler } from './chat-message-handler.ts';
import {
	createFallbackDedupeKeyGenerator,
	createShouldHandleMessage,
	type NextDedupeKey,
	type ShouldHandleMessage,
} from './message-dedupe.ts';
import { normalizeOpenCodeOptions } from './options.ts';
import { createOpenCodePromptRunners, type OpenCodeClient, type OpenCodePromptRunners } from './prompt-runners.ts';
import { createShouldHandleRootSession, type ShouldHandleSession } from './session-filter.ts';
import type { OpenCodeOptions } from './types.ts';

export type { OpenCodeClient } from './prompt-runners.ts';

export function createOpenCodeHooks(client: OpenCodeClient, rawOptions?: PluginOptions, directory?: string): Hooks {
	const options: OpenCodeOptions = normalizeOpenCodeOptions(rawOptions);
	const shouldHandleSession: ShouldHandleSession = createShouldHandleRootSession(client, directory);
	const shouldHandleMessage: ShouldHandleMessage = createShouldHandleMessage();
	const promptRunners: OpenCodePromptRunners = createOpenCodePromptRunners(client, options, directory);
	const nextFallbackDedupeKey: NextDedupeKey = createFallbackDedupeKeyGenerator();

	return {
		'chat.message': createOpenCodeChatMessageHandler(
			options,
			shouldHandleSession,
			shouldHandleMessage,
			promptRunners,
			nextFallbackDedupeKey,
		),
	};
}

export const server = ({ client, directory }: PluginInput, rawOptions?: PluginOptions): Promise<Hooks> => {
	return Promise.resolve(createOpenCodeHooks(client, rawOptions, directory));
};
