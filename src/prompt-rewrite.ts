import {
	isInternalPrompt,
	maxPromptChars,
	textFromParts,
	type ChatMessageInput,
	type ChatMessageOutput,
	type ChatPart,
	type PolisherResult,
	type TextChatPart,
} from 'english-prompt-polisher';

import type { OpenCodeOptions } from './types.ts';

type CheckPrompt = (input: ChatMessageInput, options: OpenCodeOptions, prompt: string) => Promise<PolisherResult>;

export type PromptRewriteDependencies = {
	checkPrompt: CheckPrompt;
};

export type PromptRewriteCandidate = {
	originalPrompt: string;
};

export type PromptRewriteResult = { status: 'skipped' } | { status: 'rewritten'; proposedPrompt: string };

export function shouldCheckPromptForRewrite(prompt: string, options: OpenCodeOptions): boolean {
	return (
		prompt.trim().length > 0 && !isInternalPrompt(prompt) && Array.from(prompt).length <= maxPromptChars(options)
	);
}

export function shouldUsePromptRewrite(result: PolisherResult, originalPrompt: string): boolean {
	return result.needsProposal && result.proposedPrompt.trim().length > 0 && result.proposedPrompt !== originalPrompt;
}

export function createPromptRewriteCandidate(
	output: ChatMessageOutput,
	options: OpenCodeOptions,
): PromptRewriteCandidate | undefined {
	const originalPrompt: string = textFromParts(output.parts);
	if (!shouldCheckPromptForRewrite(originalPrompt, options)) {
		return;
	}

	return { originalPrompt };
}

function isUserTextPart(part: ChatPart): part is TextChatPart {
	return part.type === 'text' && typeof part.text === 'string' && part.synthetic !== true && part.ignored !== true;
}

function rewrittenTextPart(part: TextChatPart, proposedPrompt: string): TextChatPart {
	return { ...part, text: proposedPrompt };
}

export function buildRewrittenPromptParts(
	originalParts: ChatMessageOutput['parts'],
	proposedPrompt: string,
): ChatMessageOutput['parts'] | undefined {
	// The candidate prompt is built from all user text parts, so rewrite collapses
	// them into the first user text part and prunes stale later fragments.
	const rewrittenParts: ChatMessageOutput['parts'] = [];
	let replaced: boolean = false;

	for (const part of originalParts) {
		if (!isUserTextPart(part)) {
			rewrittenParts.push(part);
			continue;
		}

		if (!replaced) {
			rewrittenParts.push(rewrittenTextPart(part, proposedPrompt));
			replaced = true;
		}
	}

	return replaced ? rewrittenParts : undefined;
}

export function applyPromptRewrite(output: ChatMessageOutput, proposedPrompt: string): boolean {
	const parts: ChatMessageOutput['parts'] | undefined = buildRewrittenPromptParts(output.parts, proposedPrompt);
	if (parts === undefined) {
		return false;
	}

	output.parts.splice(0, output.parts.length, ...parts);
	return true;
}

export async function handlePromptRewrite(
	input: ChatMessageInput,
	output: ChatMessageOutput,
	options: OpenCodeOptions,
	dependencies: PromptRewriteDependencies,
): Promise<PromptRewriteResult> {
	const candidate: PromptRewriteCandidate | undefined = createPromptRewriteCandidate(output, options);
	if (candidate === undefined) {
		return { status: 'skipped' };
	}

	const result: PolisherResult = await dependencies.checkPrompt(input, options, candidate.originalPrompt);
	if (!shouldUsePromptRewrite(result, candidate.originalPrompt)) {
		return { status: 'skipped' };
	}

	return applyPromptRewrite(output, result.proposedPrompt)
		? { status: 'rewritten', proposedPrompt: result.proposedPrompt }
		: { status: 'skipped' };
}
