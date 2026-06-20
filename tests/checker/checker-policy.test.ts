import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { CHECKER_SYSTEM_PROMPT } from 'english-prompt-polisher';

import { DEFAULT_CHECKER_AGENT, checkerRequestPolicy, type CheckerRequestPolicy } from '../../src/checker/policy.ts';
import { normalizeOpenCodeOptions } from '../../src/options.ts';
import { chatInput } from '../fixtures.ts';

void suite('checker request policy', () => {
	void test('defaults to the general checker agent, current model, and checker system prompt', () => {
		const policy: CheckerRequestPolicy = checkerRequestPolicy(chatInput(), normalizeOpenCodeOptions());

		assert.deepEqual(policy, {
			agent: DEFAULT_CHECKER_AGENT,
			model: chatInput().model,
			system: CHECKER_SYSTEM_PROMPT,
		});
	});

	void test('applies configured checker agent and model policy', () => {
		const policy: CheckerRequestPolicy = checkerRequestPolicy(
			chatInput(),
			normalizeOpenCodeOptions({ checker: { agent: 'build', model: 'openai/gpt-4.1' } }),
		);

		assert.equal(policy.agent, 'build');
		assert.deepEqual(policy.model, { providerID: 'openai', modelID: 'gpt-4.1' });
		assert.equal(policy.system, CHECKER_SYSTEM_PROMPT);
	});
});
