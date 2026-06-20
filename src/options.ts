import type { PluginOptions } from '@opencode-ai/plugin';
import { normalizeOptions, type NormalizedOptions } from 'english-prompt-polisher';

import { normalizeCheckerOptions } from './options/checker.ts';
import type { OpenCodeCheckerOptions, OpenCodeOptions, PromptMode } from './types.ts';

export { checkerOptions } from './options/checker.ts';

export const DEFAULT_OUTPUT_FILE: string = '~/opencode-english-prompt-polisher.md';

export function promptModeOption(value: unknown): PromptMode | undefined {
	return value === 'proposal' || value === 'rewrite' ? value : undefined;
}

export function resolvePromptMode(options: Pick<OpenCodeOptions, 'mode'>): PromptMode {
	return options.mode === 'rewrite' ? 'rewrite' : 'proposal';
}

export function normalizeOpenCodeOptions(rawOptions?: PluginOptions): OpenCodeOptions {
	const coreOptions: NormalizedOptions = normalizeOptions(rawOptions, { outputFile: DEFAULT_OUTPUT_FILE });
	const checker: OpenCodeCheckerOptions | undefined = normalizeCheckerOptions(rawOptions?.checker);
	const mode: PromptMode | undefined = promptModeOption(rawOptions?.mode);
	const options: OpenCodeOptions = { outputFile: coreOptions.outputFile ?? DEFAULT_OUTPUT_FILE };

	if (coreOptions.maxChars !== undefined) {
		options.maxChars = coreOptions.maxChars;
	}
	if (coreOptions.includeOriginal !== undefined) {
		options.includeOriginal = coreOptions.includeOriginal;
	}
	if (mode !== undefined) {
		options.mode = mode;
	}
	if (checker !== undefined) {
		options.checker = checker;
	}
	if (coreOptions.notion !== undefined) {
		options.notion = coreOptions.notion;
	}

	return options;
}

export function modeOption(options: OpenCodeOptions): PromptMode {
	return resolvePromptMode(options);
}
