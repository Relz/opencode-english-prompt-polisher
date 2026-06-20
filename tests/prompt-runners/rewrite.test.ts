import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import type { ChatMessageOutput, PolisherResult, WriteLog } from 'english-prompt-polisher';

import { normalizeOpenCodeOptions } from '../../src/options.ts';
import { createRewriteRunner } from '../../src/prompt-runners/rewrite.ts';
import { chatInput, chatOutput, textPart } from '../fixtures.ts';
import { chatMessageInput } from '../opencode-fixtures.ts';

type LogCall = {
	level: Parameters<WriteLog>[0];
	message: Parameters<WriteLog>[1];
	extra: Parameters<WriteLog>[2];
};

const rewriteResult: PolisherResult = {
	needsProposal: true,
	detectedLanguage: 'Spanish',
	reason: 'Prompt is not English.',
	proposedPrompt: 'Correct this.',
};

function partText(output: ChatMessageOutput): string | undefined {
	if (output.parts.length === 0) {
		return;
	}

	const part: ChatMessageOutput['parts'][number] = output.parts[0];
	return part.type === 'text' ? part.text : undefined;
}

void suite('rewrite runners', () => {
	void test('runs rewrite execution through the checker adapter', async () => {
		const checkedPrompts: string[] = [];
		const runner: ReturnType<typeof createRewriteRunner> = createRewriteRunner(
			normalizeOpenCodeOptions(),
			(input, prompt): Promise<PolisherResult> => {
				assert.deepEqual(input, chatInput());
				checkedPrompts.push(prompt);
				return Promise.resolve(rewriteResult);
			},
			(): Promise<void> => Promise.resolve(),
		);
		const output: ChatMessageOutput = chatOutput([textPart('Corrige esto')]);

		await runner(chatMessageInput(), chatInput(), output);

		assert.deepEqual(checkedPrompts, ['Corrige esto']);
		assert.equal(partText(output), 'Correct this.');
	});

	void test('logs rewrite execution failures without rejecting', async () => {
		const logs: LogCall[] = [];
		const writeLog: WriteLog = (level, message, extra): Promise<void> => {
			logs.push({ level, message, extra });
			return Promise.resolve();
		};
		const runner: ReturnType<typeof createRewriteRunner> = createRewriteRunner(
			normalizeOpenCodeOptions(),
			(): Promise<PolisherResult> => Promise.reject(new Error('checker failed')),
			writeLog,
		);

		await runner(chatMessageInput(), chatInput(), chatOutput([textPart('Corrige esto')]));

		assert.equal(logs.length, 1);
		assert.equal(logs[0].level, 'warn');
		assert.equal(logs[0].message, 'Failed to rewrite prompt');
		assert.deepEqual(logs[0].extra, {
			sessionID: 'ses_123',
			messageID: 'msg_456',
			error: 'checker failed',
		});
	});
});
