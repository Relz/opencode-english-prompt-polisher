import type { PluginModule } from '@opencode-ai/plugin';

import { server } from './server.ts';

export default {
	id: 'opencode-english-prompt-polisher',
	server,
} satisfies PluginModule;
