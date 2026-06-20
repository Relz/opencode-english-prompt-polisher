import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import type { PluginModule } from '@opencode-ai/plugin';

import plugin from 'opencode-english-prompt-polisher';
import { server } from 'opencode-english-prompt-polisher/server';

void suite('package entrypoints', () => {
	void test('exports the default OpenCode plugin module', () => {
		const module: PluginModule = plugin;

		assert.equal(module.id, 'opencode-english-prompt-polisher');
		assert.equal(module.server, server);
	});
});
