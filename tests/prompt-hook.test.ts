import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SessionPrompt } from '@opencode/plugin/promise/session';
import { Session } from '@opencode/schema/session';
import { SessionMessage } from '@opencode/schema/session-message';
import { Skill } from '@opencode/schema/skill';
import { INTERNAL_PROMPT_MARKER } from 'english-prompt-polisher';

import { createPromptHook, type PromptHook } from '../src/prompt-hook.ts';
import type { PromptTaskCoordinator } from '../src/prompt-task-coordinator.ts';

type HookCoordinator = Pick<PromptTaskCoordinator, 'admit' | 'isStopped'>;

const ORIGINAL_TEXT: string = 'Please review @first.ts and @second.ts with @review and @build using @writing.';
const REPLACEMENT: string = 'Please review the attached files.';

function createMention(text: string): { start: number; end: number; text: string } {
	const start: number = ORIGINAL_TEXT.indexOf(text);
	return { start, end: start + text.length, text };
}

function createEvent(text: string = ORIGINAL_TEXT): SessionPrompt {
	return {
		sessionID: Session.ID.make('session-1'),
		messageID: SessionMessage.ID.make('msg_test'),
		delivery: 'queue',
		metadata: { source: 'editor' },
		prompt: {
			text,
			files: [
				{
					uri: 'file:///project/first.ts',
					name: 'first.ts',
					description: 'First source file',
					mention: createMention('@first.ts'),
				},
				{ uri: 'file:///project/second.ts', name: 'second.ts', mention: createMention('@second.ts') },
			],
			agents: [
				{ name: 'review', mention: createMention('@review') },
				{ name: 'build', mention: createMention('@build') },
			],
			skills: [
				{ id: Skill.ID.make('writing'), mention: createMention('@writing') },
				{ id: Skill.ID.make('testing') },
			],
		},
	};
}

function createCoordinator(
	admit: HookCoordinator['admit'] = (): Promise<string | undefined> => Promise.resolve(REPLACEMENT),
): HookCoordinator {
	return { admit, isStopped: (): boolean => false };
}

void describe('prompt hook', (): void => {
	const skippedPrompts: { name: string; text: string; stopped: boolean }[] = [
		{ name: 'the coordinator is stopped', text: ORIGINAL_TEXT, stopped: true },
		{ name: 'the text is empty', text: '', stopped: false },
		{ name: 'the text contains only whitespace', text: ' \t\n ', stopped: false },
		{ name: 'the prompt is internal', text: `Check this prompt: ${INTERNAL_PROMPT_MARKER}`, stopped: false },
	];
	for (const { name, text, stopped } of skippedPrompts) {
		void it(`skips admission and preserves the event when ${name}`, async (): Promise<void> => {
			// Arrange

			const event: SessionPrompt = createEvent(text);
			const original: SessionPrompt = structuredClone(event);
			let admitted: boolean = false;
			const coordinator: HookCoordinator = {
				admit: (): Promise<string | undefined> => {
					admitted = true;
					return Promise.resolve(REPLACEMENT);
				},
				isStopped: (): boolean => stopped,
			};

			// Act

			await createPromptHook(coordinator)(event, new AbortController().signal);

			// Assert

			assert.equal(admitted, false);
			assert.deepEqual(event, original);
		});
	}

	void it('forwards the original request and signal, replaces text, and removes only attachment mentions', async (): Promise<void> => {
		// Arrange

		const event: SessionPrompt = createEvent(` \n${ORIGINAL_TEXT}\t `);
		const original: SessionPrompt = structuredClone(event);
		const controller: AbortController = new AbortController();
		const admissions: Parameters<HookCoordinator['admit']>[] = [];
		const coordinator: HookCoordinator = createCoordinator((...args): Promise<string | undefined> => {
			admissions.push(args);
			return Promise.resolve(REPLACEMENT);
		});

		// Act

		await createPromptHook(coordinator)(event, controller.signal);

		// Assert

		assert.equal(admissions.length, 1);
		const [request, signal]: Parameters<HookCoordinator['admit']> = admissions[0];
		assert.deepEqual(request, {
			sessionID: original.sessionID,
			messageID: original.messageID,
			text: original.prompt.text,
		});
		assert.equal(signal, controller.signal);
		assert.deepEqual(event, {
			...original,
			prompt: {
				text: REPLACEMENT,
				files: [
					{ uri: 'file:///project/first.ts', name: 'first.ts', description: 'First source file' },
					{ uri: 'file:///project/second.ts', name: 'second.ts' },
				],
				agents: [{ name: 'review' }, { name: 'build' }],
				skills: [{ id: Skill.ID.make('writing') }, { id: Skill.ID.make('testing') }],
			},
		});
		for (const attachment of [...event.prompt.files, ...event.prompt.agents, ...event.prompt.skills]) {
			assert.equal(Object.hasOwn(attachment, 'mention'), false);
		}
	});

	void it('replaces text when all attachment collections are omitted without adding them', async (): Promise<void> => {
		// Arrange

		const event: SessionPrompt = createEvent();
		event.prompt = { text: ORIGINAL_TEXT };
		const original: SessionPrompt = structuredClone(event);

		// Act

		await createPromptHook(createCoordinator())(event, new AbortController().signal);

		// Assert

		assert.deepEqual(event, { ...original, prompt: { text: REPLACEMENT } });
	});

	const unchangedResults: { name: string; result: string | undefined }[] = [
		{ name: 'no replacement', result: undefined },
		{ name: 'the original text', result: ORIGINAL_TEXT },
	];
	for (const { name, result } of unchangedResults) {
		void it(`preserves text and mentions when admission returns ${name}`, async (): Promise<void> => {
			// Arrange

			const event: SessionPrompt = createEvent();
			const original: SessionPrompt = structuredClone(event);
			const coordinator: HookCoordinator = createCoordinator((): Promise<string | undefined> =>
				Promise.resolve(result),
			);

			// Act

			await createPromptHook(coordinator)(event, new AbortController().signal);

			// Assert

			assert.deepEqual(event, original);
		});
	}

	void it('preserves the event when cancellation arrives between admission resolution and delivery', async (): Promise<void> => {
		// Arrange

		const event: SessionPrompt = createEvent();
		const original: SessionPrompt = structuredClone(event);
		const controller: AbortController = new AbortController();
		const result: PromiseWithResolvers<string | undefined> = Promise.withResolvers();
		const coordinator: HookCoordinator = createCoordinator((): Promise<string | undefined> => result.promise);
		const hook: PromptHook = createPromptHook(coordinator);

		// Act

		const delivery: Promise<void> = hook(event, controller.signal);

		// Change the signal before the hook's await continuation can deliver the result.
		result.resolve(REPLACEMENT);
		controller.abort();
		await delivery;

		// Assert

		assert.deepEqual(event, original);
	});

	void it('preserves the event when shutdown arrives between admission resolution and delivery', async (): Promise<void> => {
		// Arrange

		const event: SessionPrompt = createEvent();
		const original: SessionPrompt = structuredClone(event);
		const result: PromiseWithResolvers<string | undefined> = Promise.withResolvers();
		let stopped: boolean = false;
		const coordinator: HookCoordinator = {
			admit: (): Promise<string | undefined> => result.promise,
			isStopped: (): boolean => stopped,
		};

		// Act

		const delivery: Promise<void> = createPromptHook(coordinator)(event, new AbortController().signal);

		result.resolve(REPLACEMENT);
		stopped = true;
		await delivery;

		// Assert

		assert.deepEqual(event, original);
	});

	void it('propagates an admission failure without changing the event', async (): Promise<void> => {
		// Arrange

		const event: SessionPrompt = createEvent();
		const original: SessionPrompt = structuredClone(event);
		const failure: Error = new Error('Admission failed');
		const coordinator: HookCoordinator = createCoordinator((): Promise<string | undefined> =>
			Promise.reject(failure),
		);

		// Act

		const delivery: Promise<void> = createPromptHook(coordinator)(event, new AbortController().signal);

		// Assert

		await assert.rejects(delivery, (error: unknown): boolean => error === failure);
		assert.deepEqual(event, original);
	});
});
