import type { ChatMessageInput, ChatMessageOutput } from 'english-prompt-polisher';

import { runWithOutputSnapshotInBackground } from '../chat-output.ts';
import type { OpenCodePromptRunners } from '../prompt-runners.ts';
import type { OpenCodeChatMessageInput } from '../types.ts';

import type { RunPromptProposal } from './proposal.ts';

export function createBackgroundProposalRunner(runPromptProposal: RunPromptProposal): OpenCodePromptRunners['propose'] {
	return (input: OpenCodeChatMessageInput, coreInput: ChatMessageInput, output: ChatMessageOutput): void => {
		runWithOutputSnapshotInBackground(output, (outputSnapshot): Promise<void> =>
			runPromptProposal(input, coreInput, outputSnapshot),
		);
	};
}
