import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { buildCheckerPrompt, CHECKER_SYSTEM_PROMPT, type ChatMessageInput } from 'english-prompt-polisher';

import { buildCheckerRequestBody, type CheckerRequestBody } from '../../src/checker/request.ts';
import { normalizeOpenCodeOptions } from '../../src/options.ts';
import type { OpenCodeOptions } from '../../src/types.ts';
import { chatInput } from '../fixtures.ts';

const input: ChatMessageInput = chatInput({ messageId: undefined });
const disabledTools: CheckerRequestBody['tools'] = { bash: false, edit: false };

void suite('buildCheckerRequestBody', () => {
	void test('builds a checker-only request body with a single text prompt part', () => {
		// Arrange

		const config: OpenCodeOptions = normalizeOpenCodeOptions();
		const prompt: string = 'Fix grammar';

		// Act

		const body: CheckerRequestBody = buildCheckerRequestBody(input, config, prompt, disabledTools);

		// Assert

		assert.equal(body.agent, 'general');
		assert.deepEqual(body.model, input.model);
		assert.deepEqual(body.tools, disabledTools);
		assert.equal(body.system, CHECKER_SYSTEM_PROMPT);
		assert.deepEqual(body.parts, [{ type: 'text', text: buildCheckerPrompt(prompt) }]);
	});

	void test('applies configured checker agent and string model', () => {
		// Arrange

		const config: OpenCodeOptions = normalizeOpenCodeOptions({
			checker: { agent: 'build', model: 'openai/gpt-4.1' },
		});
		const prompt: string = 'Corrige esto';

		// Act

		const body: CheckerRequestBody = buildCheckerRequestBody(input, config, prompt, disabledTools);

		// Assert

		assert.equal(body.agent, 'build');
		assert.deepEqual(body.model, { providerID: 'openai', modelID: 'gpt-4.1' });
	});

	void test('defaults empty checker config to the general agent and current message model', () => {
		// Arrange

		const config: OpenCodeOptions = normalizeOpenCodeOptions({ checker: {} });
		const prompt: string = 'Fix grammar';

		// Act

		const body: CheckerRequestBody = buildCheckerRequestBody(input, config, prompt, disabledTools);

		// Assert

		assert.equal(body.agent, 'general');
		assert.deepEqual(body.model, input.model);
	});

	void test('uses the current message model when configured model is current', () => {
		// Arrange

		const config: OpenCodeOptions = normalizeOpenCodeOptions({ checker: { model: 'current' } });
		const prompt: string = 'Fix grammar';

		// Act

		const body: CheckerRequestBody = buildCheckerRequestBody(input, config, prompt, disabledTools);

		// Assert

		assert.equal(body.agent, 'general');
		assert.deepEqual(body.model, input.model);
	});

	void test('defaults the agent when only checker model is configured', () => {
		// Arrange

		const config: OpenCodeOptions = normalizeOpenCodeOptions({ checker: { model: 'openai/gpt-4.1' } });
		const prompt: string = 'Fix grammar';

		// Act

		const body: CheckerRequestBody = buildCheckerRequestBody(input, config, prompt, disabledTools);

		// Assert

		assert.equal(body.agent, 'general');
		assert.deepEqual(body.model, { providerID: 'openai', modelID: 'gpt-4.1' });
	});

	void test('uses configured checker agent with current message model when only agent is configured', () => {
		// Arrange

		const config: OpenCodeOptions = normalizeOpenCodeOptions({ checker: { agent: 'build' } });
		const prompt: string = 'Fix grammar';

		// Act

		const body: CheckerRequestBody = buildCheckerRequestBody(input, config, prompt, disabledTools);

		// Assert

		assert.equal(body.agent, 'build');
		assert.deepEqual(body.model, input.model);
	});

	void test('does not include checker session cleanup config in the request body', () => {
		// Arrange

		const config: OpenCodeOptions = normalizeOpenCodeOptions({
			checker: { agent: 'build', deleteSession: false, model: 'openai/gpt-4.1' },
		});
		const prompt: string = 'Fix grammar';

		// Act

		const body: CheckerRequestBody = buildCheckerRequestBody(input, config, prompt, disabledTools);

		// Assert

		assert.equal(body.agent, 'build');
		assert.deepEqual(body.model, { providerID: 'openai', modelID: 'gpt-4.1' });
		assert.equal(Object.hasOwn(body, 'deleteSession'), false);
	});

	void test('uses configured model objects', () => {
		// Arrange

		const model: NonNullable<CheckerRequestBody['model']> = {
			providerID: 'anthropic',
			modelID: 'claude-3-5-sonnet',
		};
		const config: OpenCodeOptions = normalizeOpenCodeOptions({ checker: { model } });
		const prompt: string = 'Fix grammar';

		// Act

		const body: CheckerRequestBody = buildCheckerRequestBody(input, config, prompt, disabledTools);

		// Assert

		assert.deepEqual(body.model, model);
	});

	void test('uses an undefined current message model when the input has no model', () => {
		// Arrange

		const inputWithoutModel: ChatMessageInput = chatInput({ model: undefined });
		const config: OpenCodeOptions = normalizeOpenCodeOptions({ checker: { model: 'current' } });
		const prompt: string = 'Fix grammar';

		// Act

		const body: CheckerRequestBody = buildCheckerRequestBody(inputWithoutModel, config, prompt, disabledTools);

		// Assert

		assert.equal(body.agent, 'general');
		assert.equal(body.model, undefined);
	});

	const invalidStringModelCases: { name: string; model: string }[] = [
		{ name: 'without slash', model: 'gpt-4.1' },
		{ name: 'leading slash', model: '/gpt-4.1' },
		{ name: 'trailing slash', model: 'openai/' },
		{ name: 'empty string', model: '' },
	];

	for (const testCase of invalidStringModelCases) {
		void test(`falls back to the current message model for invalid string models (${testCase.name})`, () => {
			// Arrange

			const prompt: string = 'Fix grammar';

			// Act

			const body: CheckerRequestBody = buildCheckerRequestBody(
				input,
				normalizeOpenCodeOptions({ checker: { model: testCase.model } }),
				prompt,
				disabledTools,
			);

			// Assert

			assert.deepEqual(body.model, input.model);
		});
	}

	void test('keeps slashes after the provider in string model IDs', () => {
		// Arrange

		const config: OpenCodeOptions = normalizeOpenCodeOptions({
			checker: { model: 'openrouter/openai/gpt-4.1' },
		});
		const prompt: string = 'Fix grammar';

		// Act

		const body: CheckerRequestBody = buildCheckerRequestBody(input, config, prompt, disabledTools);

		// Assert

		assert.deepEqual(body.model, { providerID: 'openrouter', modelID: 'openai/gpt-4.1' });
	});
});
