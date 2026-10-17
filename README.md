# OpenCode English Prompt Polisher

OpenCode plugin that checks each user prompt and writes a polished English proposal when the prompt is not English or needs English cleanup.

The checker uses OpenCode's configured model/auth by creating a temporary OpenCode session.

## Features

- Uses only OpenCode for prompt checking.
- Proposes English versions for non-English prompts.
- Polishes grammatically incorrect or unclear English prompts.
- Writes proposals to `~/opencode-english-prompt-polisher.md` by default.
- Optionally creates one Notion database entry per proposal.
- Deletes temporary checker sessions by default.

Powered by [english-prompt-polisher](https://www.npmjs.com/package/english-prompt-polisher), with OpenCode-specific integration provided by this plugin.

## Install From npm

Add the plugin to your OpenCode config:

```jsonc
{
	"$schema": "https://opencode.ai/config.json",
	"plugins": [
		{
			"package": "opencode-english-prompt-polisher",
			"options": {
				"mode": "proposal",
				"outputFile": "~/opencode-english-prompt-polisher.md",
				"checker": {
					"agent": "general",
					"model": "current",
					"deleteSession": true,
				},
				"notion": {
					"enabled": true,
					"token": "{env:ENGLISH_PROMPT_POLISHER_NOTION_TOKEN}",
					"databaseId": "{env:ENGLISH_PROMPT_POLISHER_NOTION_DATABASE_ID}",
				},
			},
		},
	],
}
```

## Options

| Option                  | Default                                 | Description                                                                                                                           |
| ----------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`                  | `proposal`                              | Use `proposal` to write suggestions in the background, or `rewrite` to replace the user prompt before OpenCode sends it to the model. |
| `outputFile`            | `~/opencode-english-prompt-polisher.md` | Markdown file that receives proposals.                                                                                                |
| `maxChars`              | unset (no limit)                        | Maximum prompt length in Unicode code points. Longer prompts are skipped in both modes.                                               |
| `includeOriginal`       | `true`                                  | Include the original prompt in the Markdown output.                                                                                   |
| `checker.agent`         | `general`                               | OpenCode agent used for the temporary checker session.                                                                                |
| `checker.model`         | `current`                               | Use the current session model, or set `provider/model`.                                                                               |
| `checker.deleteSession` | `true`                                  | Delete temporary checker sessions after each check.                                                                                   |
| `notion.enabled`        | `false`                                 | Create Notion database entries.                                                                                                       |
| `notion.token`          | unset                                   | Notion integration token.                                                                                                             |
| `notion.databaseId`     | unset                                   | Direct Notion database ID.                                                                                                            |
| `notion.titleProperty`  | auto-detect                             | Notion title property name.                                                                                                           |

## Rewrite Mode

Set `mode` to `rewrite` when OpenCode should receive the polished prompt instead of the original user text:

```jsonc
{
	"$schema": "https://opencode.ai/config.json",
	"plugins": [
		{
			"package": "opencode-english-prompt-polisher",
			"options": {
				"mode": "rewrite",
				"checker": {
					"agent": "general",
					"model": "current",
				},
			},
		},
	],
}
```

Rewrite mode waits for the checker before OpenCode continues. If the checker fails or decides no rewrite is needed, the original prompt is left unchanged.
Rewrite mode does not write Markdown or Notion proposals.

## Notion Setup

1. Create a Notion integration and copy its token.
2. Share the target database with the integration.
3. Export the values before starting OpenCode:

```sh
export ENGLISH_PROMPT_POLISHER_NOTION_TOKEN="secret_..."
export ENGLISH_PROMPT_POLISHER_NOTION_DATABASE_ID="..."
```

4. Reference the values from the plugin config with OpenCode env expansion:

```jsonc
"notion": {
  "enabled": true,
  "token": "{env:ENGLISH_PROMPT_POLISHER_NOTION_TOKEN}",
  "databaseId": "{env:ENGLISH_PROMPT_POLISHER_NOTION_DATABASE_ID}"
}
```

The database must have a title property. These optional properties are filled only when they exist with matching Notion types:

- `Detected Language`: rich text
- `Conversation ID`: rich text
- `Created At`: date

The full reason, original prompt, and proposed English prompt are stored in the Notion page body.

## Output Example

````md
## 2026-06-13T12:00:00.000Z

- Conversation ID: ses_123
- Message ID: msg_456
- Detected Language: Russian
- Reason: Prompt is written in Russian and should be translated to English.

### Original Prompt

```text
Создай плагин для OpenCode
```

### Proposed English Prompt

```text
Create a plugin for OpenCode.
```
````

## Notes

- In `proposal` mode, the original user prompt is not modified or blocked.
- In `rewrite` mode, the polished prompt replaces the original text in session history and is sent to the model. File, agent, and skill attachments are preserved.
- If the checker or Notion write fails, the plugin logs a warning and lets the original prompt continue.
- In `proposal` mode, proposals can appear after OpenCode has already started responding.
- Because every prompt requires an extra OpenCode model call, this plugin can increase token usage.
