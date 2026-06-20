import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import type { ChatMessageOutput } from 'english-prompt-polisher';

import { runWithOutputSnapshotInBackground, snapshotChatMessageOutput } from '../src/chat-output.ts';

import { chatOutput, textPart } from './fixtures.ts';

void suite('chat output helpers', () => {
	void test('snapshots output parts without sharing part objects', () => {
		const expectedPart: ChatMessageOutput['parts'][number] = textPart('Original', { id: 'prt_original' });
		const output: ChatMessageOutput = chatOutput([textPart('Original', { id: 'prt_original' })]);

		const snapshot: ChatMessageOutput = snapshotChatMessageOutput(output);
		output.parts[0].text = 'Changed';

		assert.deepEqual(snapshot.message, output.message);
		assert.notEqual(snapshot.parts, output.parts);
		assert.notEqual(snapshot.parts[0], output.parts[0]);
		assert.deepEqual(snapshot.parts[0], expectedPart);
	});

	void test('runs background tasks with an output snapshot', async () => {
		const output: ChatMessageOutput = chatOutput([textPart('Original')]);
		const finished: PromiseWithResolvers<ChatMessageOutput> = Promise.withResolvers<ChatMessageOutput>();
		let callbackRan: boolean = false;

		runWithOutputSnapshotInBackground(output, (snapshot): Promise<void> => {
			callbackRan = true;
			finished.resolve(snapshot);
			return Promise.resolve();
		});
		assert.equal(callbackRan, false);
		output.parts[0].text = 'Changed';
		const snapshot: ChatMessageOutput = await finished.promise;

		assert.equal(snapshot.parts[0].text, 'Original');
	});
});
