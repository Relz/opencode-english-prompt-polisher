import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { disabledCheckerTools, disabledToolMap, type CheckerToolClient } from '../../src/checker/tools.ts';

type ToolIdsRequest = Parameters<CheckerToolClient['tool']['ids']>[0];
type CheckerToolClientFixture = {
	client: CheckerToolClient;
	requests: ToolIdsRequest[];
};

function checkerToolClient(toolIds: string[] | undefined): CheckerToolClientFixture {
	const requests: ToolIdsRequest[] = [];
	const client: CheckerToolClient = {
		tool: {
			ids: (request?: ToolIdsRequest): Promise<{ data: string[] | undefined }> => {
				requests.push(request);
				return Promise.resolve({ data: toolIds });
			},
		},
	};

	return { client, requests };
}

void suite('disabledCheckerTools', () => {
	void test('builds a disabled tool map from tool ids', () => {
		assert.deepEqual(disabledToolMap(['bash', 'edit']), { bash: false, edit: false });
	});

	void test('builds a disabled tool map and passes the directory query', async () => {
		// Arrange

		const directory: string = '/workspace/project';
		const { client, requests }: CheckerToolClientFixture = checkerToolClient(['bash', 'edit']);

		// Act

		const tools: Record<string, boolean> = await disabledCheckerTools(client, directory);

		// Assert

		assert.deepEqual(tools, { bash: false, edit: false });
		assert.deepEqual(requests, [{ query: { directory } }]);
	});

	void test('rejects when OpenCode does not return tool ids', async () => {
		// Arrange

		const { client }: CheckerToolClientFixture = checkerToolClient(undefined);

		// Act

		const act = (): Promise<Record<string, boolean>> => disabledCheckerTools(client);

		// Assert

		await assert.rejects(act, /tool ids/);
	});
});
