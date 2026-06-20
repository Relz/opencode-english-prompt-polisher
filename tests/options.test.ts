import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import type { PluginOptions } from '@opencode-ai/plugin';

import { DEFAULT_OUTPUT_FILE, checkerOptions, modeOption, normalizeOpenCodeOptions } from '../src/options.ts';
import type { OpenCodeOptions } from '../src/types.ts';

void suite('normalizeOpenCodeOptions', () => {
	void test('applies plugin defaults without raw options', () => {
		// Act

		const options: OpenCodeOptions = normalizeOpenCodeOptions();

		// Assert

		assert.deepEqual(options, { outputFile: DEFAULT_OUTPUT_FILE });
		assert.deepEqual(checkerOptions(options), {});
		assert.equal(modeOption(options), 'proposal');
	});

	void test('keeps valid OpenCode plugin options', () => {
		// Arrange

		const rawOptions: PluginOptions = {
			outputFile: '~/polished-prompts.md',
			maxChars: 1200,
			includeOriginal: false,
			mode: 'rewrite',
			checker: {
				agent: 'build',
				deleteSession: false,
				model: { providerID: 'anthropic', modelID: 'claude-sonnet' },
			},
			notion: {
				enabled: true,
				token: 'notion_secret',
				databaseId: 'db_123',
				titleProperty: 'Prompt',
			},
		};

		// Act

		const options: OpenCodeOptions = normalizeOpenCodeOptions(rawOptions);

		// Assert

		assert.deepEqual(options, {
			outputFile: '~/polished-prompts.md',
			maxChars: 1200,
			includeOriginal: false,
			mode: 'rewrite',
			checker: {
				agent: 'build',
				deleteSession: false,
				model: { providerID: 'anthropic', modelID: 'claude-sonnet' },
			},
			notion: {
				enabled: true,
				token: 'notion_secret',
				databaseId: 'db_123',
				titleProperty: 'Prompt',
			},
		});
		assert.equal(modeOption(options), 'rewrite');
	});

	void test('normalizes checker string models into model objects', () => {
		// Act

		const options: OpenCodeOptions = normalizeOpenCodeOptions({
			checker: { model: 'openrouter/openai/gpt-4.1' },
		});

		// Assert

		assert.deepEqual(options.checker?.model, { providerID: 'openrouter', modelID: 'openai/gpt-4.1' });
	});

	void test('keeps the current checker model option', () => {
		// Act

		const options: OpenCodeOptions = normalizeOpenCodeOptions({ checker: { model: 'current' } });

		// Assert

		assert.equal(options.checker?.model, 'current');
	});

	void test('drops malformed checker string models while preserving valid checker fields', () => {
		// Act

		const options: OpenCodeOptions = normalizeOpenCodeOptions({ checker: { agent: 'build', model: 'gpt-4.1' } });

		// Assert

		assert.deepEqual(options.checker, { agent: 'build' });
	});

	void test('drops malformed option values while preserving valid nested fields', () => {
		// Arrange

		const rawOptions: PluginOptions = {
			outputFile: '',
			maxChars: 0,
			includeOriginal: 'false',
			mode: 'blocking',
			checker: {
				agent: '',
				deleteSession: 'false',
				model: { providerID: 'anthropic', modelID: 42 },
			},
			notion: {
				enabled: 'true',
				token: '',
				databaseId: 'db_123',
				titleProperty: 'Prompt',
			},
		};

		// Act

		const options: OpenCodeOptions = normalizeOpenCodeOptions(rawOptions);

		// Assert

		assert.deepEqual(options, {
			outputFile: DEFAULT_OUTPUT_FILE,
			notion: {
				databaseId: 'db_123',
				titleProperty: 'Prompt',
			},
		});
		assert.deepEqual(checkerOptions(options), {});
		assert.equal(modeOption(options), 'proposal');
	});
});
