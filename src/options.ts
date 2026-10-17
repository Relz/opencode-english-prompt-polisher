import type { PluginOptions } from '@opencode/plugin';
import { normalizeOptions, type NormalizedOptions } from 'english-prompt-polisher';

import { normalizeCheckerOptions } from './options/checker.ts';
import type { OpenCodeCheckerOptions, OpenCodeOptions, PromptMode } from './types.ts';

export { checkerOptions } from './options/checker.ts';

export const DEFAULT_OUTPUT_FILE: string = '~/opencode-english-prompt-polisher.md';

export function normalizeOpenCodeOptions(rawOptions?: PluginOptions): OpenCodeOptions {
	const coreOptions: NormalizedOptions = normalizeOptions(rawOptions, {
		outputFile: DEFAULT_OUTPUT_FILE,
	});
	const checker: OpenCodeCheckerOptions | undefined = normalizeCheckerOptions(rawOptions?.checker);
	const options: OpenCodeOptions = { outputFile: coreOptions.outputFile ?? DEFAULT_OUTPUT_FILE };

	if (coreOptions.maxChars !== undefined) {
		options.maxChars = coreOptions.maxChars;
	}
	if (coreOptions.includeOriginal !== undefined) {
		options.includeOriginal = coreOptions.includeOriginal;
	}
	if (coreOptions.mode !== undefined) {
		options.mode = coreOptions.mode;
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
	return options.mode ?? 'proposal';
}
