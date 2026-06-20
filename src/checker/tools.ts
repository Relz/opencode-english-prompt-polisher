import { queryForDirectory } from './query.ts';
import type { CheckerRequestBody } from './request.ts';

type ClientResult<T> = Promise<{ data: T | undefined }>;
type ToolIdsOptions = { query?: { directory?: string } };
type ToolIdsResultData = string[];

export type CheckerToolClient = {
	tool: {
		ids: (options?: ToolIdsOptions) => ClientResult<ToolIdsResultData>;
	};
};

export function disabledToolMap(toolIds: string[]): CheckerRequestBody['tools'] {
	const tools: CheckerRequestBody['tools'] = {};
	for (const toolId of toolIds) {
		tools[toolId] = false;
	}
	return tools;
}

export async function disabledCheckerTools(
	client: CheckerToolClient,
	directory?: string,
): Promise<CheckerRequestBody['tools']> {
	const query: ReturnType<typeof queryForDirectory> = queryForDirectory(directory);
	const result: Awaited<ReturnType<CheckerToolClient['tool']['ids']>> = await client.tool.ids(
		query === undefined ? undefined : { query },
	);
	const toolIds: ToolIdsResultData | undefined = result.data;
	if (toolIds === undefined) {
		throw new Error('OpenCode did not return tool ids for the checker session');
	}

	return disabledToolMap(toolIds);
}
