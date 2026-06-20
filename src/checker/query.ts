export type DirectoryQuery = { directory: string };

export function queryForDirectory(directory?: string): DirectoryQuery | undefined {
	return directory === undefined ? undefined : { directory };
}
