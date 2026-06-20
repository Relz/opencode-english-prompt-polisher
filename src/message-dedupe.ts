export type OpenCodeMessageDedupeInput = {
	conversationId: string;
	messageId?: string;
	dedupeKey?: string;
};

export type NextDedupeKey = () => string;
export type ShouldHandleMessage = (input: OpenCodeMessageDedupeInput) => boolean;

export function createFallbackDedupeKeyGenerator(): NextDedupeKey {
	let fallbackDedupeID: number = 0;

	return (): string => {
		fallbackDedupeID += 1;
		return String(fallbackDedupeID);
	};
}

function hasStableKey(value: string | undefined): value is string {
	return value !== undefined && value.length > 0;
}

function messageKey(input: OpenCodeMessageDedupeInput): string {
	if (hasStableKey(input.messageId)) {
		return `message:${input.messageId}`;
	}
	if (hasStableKey(input.dedupeKey)) {
		return `fallback:${input.conversationId}:${input.dedupeKey}`;
	}
	return `conversation:${input.conversationId}`;
}

export function createShouldHandleMessage(): ShouldHandleMessage {
	const seen: Set<string> = new Set();

	return (input: OpenCodeMessageDedupeInput): boolean => {
		const key: string = messageKey(input);
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	};
}
