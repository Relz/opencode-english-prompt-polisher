import type { ChatMessageOutput, ChatPart } from 'english-prompt-polisher';

export function snapshotChatMessageOutput(output: ChatMessageOutput): ChatMessageOutput {
	return {
		message: output.message,
		parts: output.parts.map((part): ChatPart => ({ ...part })),
	};
}

type BackgroundOutputRunner = (output: ChatMessageOutput) => Promise<void>;

function scheduleBackgroundTask(run: () => Promise<void>): void {
	setTimeout((): void => {
		void run();
	}, 0);
}

export function runWithOutputSnapshotInBackground(output: ChatMessageOutput, run: BackgroundOutputRunner): void {
	const outputSnapshot: ChatMessageOutput = snapshotChatMessageOutput(output);
	scheduleBackgroundTask((): Promise<void> => run(outputSnapshot));
}
