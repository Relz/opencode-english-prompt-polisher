import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import type { ChatMessageOutput, PolisherResult, WriteLog } from 'english-prompt-polisher';

import { normalizeOpenCodeOptions } from '../../src/options.ts';
import { createBackgroundProposalRunner } from '../../src/prompt-runners/proposal-background.ts';
import { createPromptProposalExecutor, type RunPromptProposal } from '../../src/prompt-runners/proposal.ts';
import { chatInput, chatOutput, textPart } from '../fixtures.ts';
import { chatMessageInput } from '../opencode-fixtures.ts';

type LogCall = {
	level: Parameters<WriteLog>[0];
	message: Parameters<WriteLog>[1];
	extra: Parameters<WriteLog>[2];
};

const unchangedResult: PolisherResult = {
	needsProposal: false,
	detectedLanguage: 'Spanish',
	reason: 'No proposal needed.',
	proposedPrompt: 'Corrige esto',
};

function partText(output: ChatMessageOutput): string | undefined {
	if (output.parts.length === 0) {
		return;
	}

	const part: ChatMessageOutput['parts'][number] = output.parts[0];
	return part.type === 'text' ? part.text : undefined;
}

void suite('proposal runners', () => {
	void test('runs proposal execution through the checker adapter', async () => {
		const checkedPrompts: string[] = [];
		const runner: RunPromptProposal = createPromptProposalExecutor(
			normalizeOpenCodeOptions(),
			(input, prompt): Promise<PolisherResult> => {
				assert.deepEqual(input, chatInput());
				checkedPrompts.push(prompt);
				return Promise.resolve(unchangedResult);
			},
			(): Promise<void> => Promise.resolve(),
		);

		await runner(chatMessageInput(), chatInput(), chatOutput([textPart('Corrige esto')]));

		assert.deepEqual(checkedPrompts, ['Corrige esto']);
	});

	void test('wraps proposal execution in background scheduling with an output snapshot', async () => {
		const runFinished: PromiseWithResolvers<ChatMessageOutput> = Promise.withResolvers<ChatMessageOutput>();
		const output: ChatMessageOutput = chatOutput([textPart('Original')]);
		const runPromptProposal: RunPromptProposal = (_input, _coreInput, outputSnapshot): Promise<void> => {
			runFinished.resolve(outputSnapshot);
			return Promise.resolve();
		};
		const runner: ReturnType<typeof createBackgroundProposalRunner> =
			createBackgroundProposalRunner(runPromptProposal);

		runner(chatMessageInput(), chatInput(), output);
		output.parts[0].text = 'Changed';

		const outputSnapshot: ChatMessageOutput = await runFinished.promise;

		assert.notEqual(outputSnapshot.parts[0], output.parts[0]);
		assert.equal(partText(outputSnapshot), 'Original');
		assert.equal(partText(output), 'Changed');
	});

	void test('logs proposal execution failures without rejecting', async () => {
		const logs: LogCall[] = [];
		const writeLog: WriteLog = (level, message, extra): Promise<void> => {
			logs.push({ level, message, extra });
			return Promise.resolve();
		};
		const runner: RunPromptProposal = createPromptProposalExecutor(
			normalizeOpenCodeOptions(),
			(): Promise<PolisherResult> => Promise.reject(new Error('checker failed')),
			writeLog,
		);

		await runner(chatMessageInput(), chatInput(), chatOutput([textPart('Corrige esto')]));

		assert.equal(logs.length, 1);
		assert.equal(logs[0].level, 'warn');
		assert.equal(logs[0].message, 'Failed to polish prompt');
		assert.deepEqual(logs[0].extra, {
			sessionID: 'ses_123',
			messageID: 'msg_456',
			error: 'checker failed',
		});
	});
});
