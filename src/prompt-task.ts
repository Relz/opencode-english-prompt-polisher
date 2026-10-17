export type PromptRequest = {
	sessionID: string;
	messageID?: string;
	text: string;
};

export type PromptHandlingResult = {
	text?: string;
};

export type PreparedPrompt = () => Promise<PromptHandlingResult>;

export type PreparePrompt = (request: PromptRequest, signal: AbortSignal) => Promise<PreparedPrompt | undefined>;
