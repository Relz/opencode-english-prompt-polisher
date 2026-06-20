import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import {
	INTERNAL_PROMPT_MARKER,
	type ChatMessageInput,
	type ChatMessageOutput,
	type ChatPart,
	type PolisherResult,
} from 'english-prompt-polisher';

import { normalizeOpenCodeOptions } from '../src/options.ts';
import {
	applyPromptRewrite,
	createPromptRewriteCandidate,
	handlePromptRewrite,
	shouldCheckPromptForRewrite,
	shouldUsePromptRewrite,
	type PromptRewriteDependencies,
	type PromptRewriteResult,
} from '../src/prompt-rewrite.ts';
import type { OpenCodeOptions } from '../src/types.ts';

import { chatInput, chatOutput, textPart } from './fixtures.ts';

type CheckPromptArgs = Parameters<PromptRewriteDependencies['checkPrompt']>;

function partID(part: ChatPart): unknown {
	return part.id;
}

function partText(part: ChatPart): string | undefined {
	return part.type === 'text' ? part.text : undefined;
}

function polisherResult(overrides: Partial<PolisherResult> = {}): PolisherResult {
	return {
		needsProposal: true,
		detectedLanguage: 'Spanish',
		reason: 'Prompt is not English.',
		proposedPrompt: 'Correct this.',
		...overrides,
	};
}

void suite('prompt rewrite', () => {
	void test('checks non-empty non-internal prompts within the configured length limit', () => {
		assert.equal(shouldCheckPromptForRewrite('Corrige esto', normalizeOpenCodeOptions()), true);
		assert.equal(shouldCheckPromptForRewrite('', normalizeOpenCodeOptions()), false);
		assert.equal(
			shouldCheckPromptForRewrite(`Corrige esto\n${INTERNAL_PROMPT_MARKER}`, normalizeOpenCodeOptions()),
			false,
		);
		assert.equal(shouldCheckPromptForRewrite('abcdef', normalizeOpenCodeOptions({ maxChars: 5 })), false);
	});

	void test('uses rewrite results only when they produce a different non-empty prompt', () => {
		const result: PolisherResult = polisherResult();

		assert.equal(shouldUsePromptRewrite(result, 'Corrige esto'), true);
		assert.equal(shouldUsePromptRewrite({ ...result, needsProposal: false }, 'Corrige esto'), false);
		assert.equal(shouldUsePromptRewrite({ ...result, proposedPrompt: '  \n\t  ' }, 'Corrige esto'), false);
		assert.equal(shouldUsePromptRewrite({ ...result, proposedPrompt: 'Corrige esto' }, 'Corrige esto'), false);
	});

	void test('extracts user-visible prompt rewrite candidates', () => {
		const output: ChatMessageOutput = chatOutput([textPart('Corrige esto')]);

		const candidate: ReturnType<typeof createPromptRewriteCandidate> = createPromptRewriteCandidate(
			output,
			normalizeOpenCodeOptions({ maxChars: 100 }),
		);

		assert.equal(candidate?.originalPrompt, 'Corrige esto');
	});

	void test('skips invalid rewrite candidates', () => {
		const emptyOutput: ChatMessageOutput = chatOutput([textPart('  \t  ')]);
		const internalOutput: ChatMessageOutput = chatOutput([textPart(`${INTERNAL_PROMPT_MARKER}\n\nFix this`)]);
		const longOutput: ChatMessageOutput = chatOutput([textPart('abcdef')]);
		const options: OpenCodeOptions = normalizeOpenCodeOptions({ maxChars: 5 });

		assert.equal(createPromptRewriteCandidate(emptyOutput, normalizeOpenCodeOptions()), undefined);
		assert.equal(createPromptRewriteCandidate(internalOutput, normalizeOpenCodeOptions()), undefined);
		assert.equal(createPromptRewriteCandidate(longOutput, options), undefined);
	});

	void test('collapses all user text into the first user text part during rewrite', () => {
		const nonTextPart: ChatPart = { id: 'prt_tool', type: 'tool', text: 'Tool context' };
		const output: ChatMessageOutput = chatOutput([
			textPart('Corrige esto', { id: 'prt_first' }),
			textPart('Synthetic context', { id: 'prt_synthetic', synthetic: true }),
			textPart('Ignored context', { id: 'prt_ignored', ignored: true }),
			nonTextPart,
			textPart('Por favor', { id: 'prt_second' }),
		]);
		const originalParts: ChatMessageOutput['parts'] = output.parts;

		const rewritten: boolean = applyPromptRewrite(output, 'Correct this.');

		assert.equal(rewritten, true);
		assert.equal(output.parts, originalParts);
		assert.deepEqual(output.parts.map(partID), ['prt_first', 'prt_synthetic', 'prt_ignored', 'prt_tool']);
		assert.equal(partText(output.parts[0]), 'Correct this.');
		assert.equal(partText(output.parts[1]), 'Synthetic context');
		assert.equal(partText(output.parts[2]), 'Ignored context');
		assert.deepEqual(output.parts[3], nonTextPart);
		assert.equal(
			output.parts.some((part): boolean => partText(part) === 'Por favor'),
			false,
		);
	});

	void test('does not rewrite when no user text part exists', () => {
		const output: ChatMessageOutput = chatOutput([
			textPart('Synthetic context', { id: 'prt_synthetic', synthetic: true }),
			textPart('Ignored context', { id: 'prt_ignored', ignored: true }),
		]);
		const originalParts: ChatMessageOutput['parts'] = output.parts;

		const rewritten: boolean = applyPromptRewrite(output, 'Correct this.');

		assert.equal(rewritten, false);
		assert.equal(output.parts, originalParts);
		assert.deepEqual(output.parts.map(partID), ['prt_synthetic', 'prt_ignored']);
		assert.equal(partText(output.parts[0]), 'Synthetic context');
	});

	void test('checks and rewrites changed prompt results', async () => {
		const input: ChatMessageInput = chatInput();
		const output: ChatMessageOutput = chatOutput([textPart('  Corrige esto  '), textPart('  Por favor  ')]);
		const options: OpenCodeOptions = normalizeOpenCodeOptions({ maxChars: 100 });
		let checkPromptArgs: CheckPromptArgs | undefined;
		const dependencies: PromptRewriteDependencies = {
			checkPrompt: (...args): Promise<PolisherResult> => {
				checkPromptArgs = args;
				return Promise.resolve(polisherResult());
			},
		};

		const result: PromptRewriteResult = await handlePromptRewrite(input, output, options, dependencies);

		assert.deepEqual(result, { status: 'rewritten', proposedPrompt: 'Correct this.' });
		assert.ok(checkPromptArgs);
		assert.equal(checkPromptArgs[0], input);
		assert.equal(checkPromptArgs[1], options);
		assert.equal(checkPromptArgs[2], 'Corrige esto\n\nPor favor');
		assert.deepEqual(output.parts.map(partText), ['Correct this.']);
	});

	void test('skips without checking when output has no rewrite candidate', async () => {
		const input: ChatMessageInput = chatInput();
		const output: ChatMessageOutput = chatOutput([textPart('  \t  ')]);
		let checkPromptCalls: number = 0;
		const dependencies: PromptRewriteDependencies = {
			checkPrompt: (): Promise<PolisherResult> => {
				checkPromptCalls += 1;
				return Promise.reject(new Error('Unexpected prompt check'));
			},
		};

		const result: PromptRewriteResult = await handlePromptRewrite(
			input,
			output,
			normalizeOpenCodeOptions(),
			dependencies,
		);

		assert.deepEqual(result, { status: 'skipped' });
		assert.equal(checkPromptCalls, 0);
	});

	void test('skips when the checker result should not rewrite', async () => {
		const input: ChatMessageInput = chatInput();
		const output: ChatMessageOutput = chatOutput([textPart('Corrige esto')]);
		const options: OpenCodeOptions = normalizeOpenCodeOptions();
		let checkPromptArgs: CheckPromptArgs | undefined;
		const dependencies: PromptRewriteDependencies = {
			checkPrompt: (...args): Promise<PolisherResult> => {
				checkPromptArgs = args;
				return Promise.resolve(polisherResult({ needsProposal: false }));
			},
		};

		const result: PromptRewriteResult = await handlePromptRewrite(input, output, options, dependencies);

		assert.deepEqual(result, { status: 'skipped' });
		assert.ok(checkPromptArgs);
		assert.equal(checkPromptArgs[0], input);
		assert.equal(checkPromptArgs[1], options);
		assert.equal(checkPromptArgs[2], 'Corrige esto');
		assert.deepEqual(output.parts.map(partText), ['Corrige esto']);
	});
});
