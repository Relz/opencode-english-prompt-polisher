import type { ChatModel, CheckerOptions, NotionOptions, PromptHandlingMode } from 'english-prompt-polisher';

export type PromptMode = PromptHandlingMode;

export type OpenCodeChatModel = ChatModel & {
	variant?: string;
};

export type OpenCodeCheckerModel = ChatModel | 'current';

export type OpenCodeCheckerOptions = Omit<CheckerOptions, 'model'> & {
	agent?: string;
	deleteSession?: boolean;
	model?: OpenCodeCheckerModel;
};

export type OpenCodeOptions = {
	outputFile: string;
	maxChars?: number;
	includeOriginal?: boolean;
	checker?: OpenCodeCheckerOptions;
	notion?: NotionOptions;
	mode?: PromptMode;
};

export type OpenCodeChatMessageInput = {
	sessionID: string;
	messageID?: string;
	model?: OpenCodeChatModel;
};
