import {
	booleanOption,
	isRecord,
	normalizeCheckerOptions as normalizeCoreCheckerOptions,
	stringOption,
	type NormalizedCheckerOptions,
} from 'english-prompt-polisher';

import type { OpenCodeCheckerOptions, OpenCodeOptions } from '../types.ts';

export function normalizeCheckerOptions(value: unknown): OpenCodeCheckerOptions | undefined {
	if (!isRecord(value)) {
		return;
	}

	const coreChecker: NormalizedCheckerOptions | undefined = normalizeCoreCheckerOptions(value);
	const checker: OpenCodeCheckerOptions = {};
	let hasOptions: boolean = false;
	const agent: string | undefined = stringOption(value.agent);
	const deleteSession: boolean | undefined = booleanOption(value.deleteSession);

	if (agent !== undefined) {
		checker.agent = agent;
		hasOptions = true;
	}
	if (deleteSession !== undefined) {
		checker.deleteSession = deleteSession;
		hasOptions = true;
	}
	if (coreChecker?.model !== undefined) {
		checker.model = coreChecker.model;
		hasOptions = true;
	}

	return hasOptions ? checker : undefined;
}

export function checkerOptions(options: OpenCodeOptions): OpenCodeCheckerOptions {
	return options.checker ?? {};
}
