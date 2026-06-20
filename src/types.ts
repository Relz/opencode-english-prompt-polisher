import type { ChatModel, CheckerOptions, NotionOptions } from 'english-prompt-polisher';

export type PromptMode = 'proposal' | 'rewrite';

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
	model?: ChatModel;
};
