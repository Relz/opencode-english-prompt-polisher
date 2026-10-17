import { stderr } from 'node:process';

import type { WriteLog } from 'english-prompt-polisher';

export const writeStderrLog: WriteLog = (level, message, extra): Promise<void> => {
	try {
		stderr.write(`${JSON.stringify({ service: 'opencode-english-prompt-polisher', level, message, extra })}\n`);
	} catch {
		// Logging must never block the user's prompt.
	}
	return Promise.resolve();
};
