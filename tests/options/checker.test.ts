import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkerOptions, normalizeCheckerOptions } from '../../src/options/checker.ts';
import type { OpenCodeCheckerOptions, OpenCodeOptions } from '../../src/types.ts';

void describe('normalizeCheckerOptions', (): void => {
	void it('rejects non-record inputs', (): void => {
		// Arrange

		const inputs: unknown[] = [undefined, null, 'general', []];

		// Act

		const results: (OpenCodeCheckerOptions | undefined)[] = inputs.map(normalizeCheckerOptions);

		// Assert

		for (const [index, input] of inputs.entries()) {
			assert.equal(results[index], undefined, `input: ${JSON.stringify(input)}`);
		}
	});

	void it('returns undefined when no recognized option is usable', (): void => {
		// Arrange

		const inputs: unknown[] = [{}, { unknown: true }, { agent: '', deleteSession: 'false', model: 'invalid' }];

		// Act

		const results: (OpenCodeCheckerOptions | undefined)[] = inputs.map(normalizeCheckerOptions);

		// Assert

		for (const [index, input] of inputs.entries()) {
			assert.equal(results[index], undefined, `input: ${JSON.stringify(input)}`);
		}
	});

	void it('accepts an agent without other options', (): void => {
		// Arrange

		const input: unknown = { agent: 'general' };

		// Act

		const result: OpenCodeCheckerOptions | undefined = normalizeCheckerOptions(input);

		// Assert

		assert.deepEqual(result, { agent: 'general' });
	});

	for (const deleteSession of [true, false]) {
		void it(`preserves deleteSession: ${deleteSession} without other options`, (): void => {
			// Arrange

			const input: unknown = { deleteSession };

			// Act

			const result: OpenCodeCheckerOptions | undefined = normalizeCheckerOptions(input);

			// Assert

			assert.deepEqual(result, { deleteSession });
		});
	}

	const modelCases: { name: string; input: unknown; expected: OpenCodeCheckerOptions }[] = [
		{
			name: 'the current model',
			input: { model: 'current' },
			expected: { model: 'current' },
		},
		{
			name: 'a provider/model string',
			input: { model: 'provider/model' },
			expected: { model: { providerID: 'provider', modelID: 'model' } },
		},
		{
			name: 'a model object',
			input: { model: { providerID: 'provider', modelID: 'model' } },
			expected: { model: { providerID: 'provider', modelID: 'model' } },
		},
	];

	for (const { name, input, expected } of modelCases) {
		void it(`normalizes ${name} without other options`, (): void => {
			// Arrange

			const options: unknown = input;

			// Act

			const result: OpenCodeCheckerOptions | undefined = normalizeCheckerOptions(options);

			// Assert

			assert.deepEqual(result, expected);
		});
	}

	void it('combines recognized options and discards unknown keys', (): void => {
		// Arrange

		const input: unknown = { agent: 'general', deleteSession: false, model: 'provider/model', unknown: true };

		// Act

		const result: OpenCodeCheckerOptions | undefined = normalizeCheckerOptions(input);

		// Assert

		assert.deepEqual(result, {
			agent: 'general',
			deleteSession: false,
			model: { providerID: 'provider', modelID: 'model' },
		});
	});

	void it('retains a valid agent when sibling options are invalid', (): void => {
		// Arrange

		const input: unknown = { agent: 'general', deleteSession: 'false', model: 'invalid' };

		// Act

		const result: OpenCodeCheckerOptions | undefined = normalizeCheckerOptions(input);

		// Assert

		assert.deepEqual(result, { agent: 'general' });
	});

	void it('retains an explicit false when the agent is invalid', (): void => {
		// Arrange

		const input: unknown = { agent: 42, deleteSession: false };

		// Act

		const result: OpenCodeCheckerOptions | undefined = normalizeCheckerOptions(input);

		// Assert

		assert.deepEqual(result, { deleteSession: false });
	});

	void it('retains a valid model when plugin-specific options are invalid', (): void => {
		// Arrange

		const input: unknown = { agent: '', deleteSession: 'false', model: 'current' };

		// Act

		const result: OpenCodeCheckerOptions | undefined = normalizeCheckerOptions(input);

		// Assert

		assert.deepEqual(result, { model: 'current' });
	});
});

void describe('checkerOptions', (): void => {
	void it('returns empty options when checker configuration is absent', (): void => {
		// Arrange

		const options: OpenCodeOptions = { outputFile: 'output.md' };

		// Act

		const result: OpenCodeCheckerOptions = checkerOptions(options);

		// Assert

		assert.deepEqual(result, {});
	});

	void it('returns configured checker values without applying defaults', (): void => {
		// Arrange

		const options: OpenCodeOptions = {
			outputFile: 'output.md',
			checker: { agent: 'general', deleteSession: false, model: 'current' },
		};

		// Act

		const result: OpenCodeCheckerOptions = checkerOptions(options);

		// Assert

		assert.deepEqual(result, { agent: 'general', deleteSession: false, model: 'current' });
	});
});
