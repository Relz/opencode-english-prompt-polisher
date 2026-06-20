import eslintJs from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import { defineConfig } from 'eslint/config';
import eslintPluginImportX from 'eslint-plugin-import-x';
import typescriptEslint from 'typescript-eslint';

export default defineConfig(
	eslintJs.configs.recommended,
	...typescriptEslint.configs.strictTypeChecked,
	...typescriptEslint.configs.stylisticTypeChecked,
	eslintPluginImportX.flatConfigs.recommended,
	eslintPluginImportX.flatConfigs.typescript,
	{
		files: ['src/**/*.ts', 'tests/**/*.ts'],
		languageOptions: {
			parserOptions: {
				project: './tsconfig.json',
			},
		},
		settings: {
			'import-x/resolver': {
				typescript: {
					project: './tsconfig.json',
				},
			},
		},
		rules: {
			'@typescript-eslint/consistent-generic-constructors': ['error', 'type-annotation'],

			// Disabled rules
			'class-methods-use-this': 'off',
			'dot-notation': 'off',
			'no-nested-ternary': 'off',
			'no-plusplus': 'off',
			'object-shorthand': 'off',
			'require-await': 'off',
			'@typescript-eslint/consistent-type-definitions': 'off',
			'@typescript-eslint/lines-between-class-members': 'off',
			'@typescript-eslint/no-inferrable-types': 'off',
			'@typescript-eslint/no-shadow': 'off',

			// Customization
			'@typescript-eslint/naming-convention': [
				'error',
				{
					selector: 'import',
					format: ['camelCase', 'PascalCase'],
				},
				{
					selector: 'default',
					format: ['camelCase'],
				},
				{
					selector: 'variable',
					format: ['camelCase'],
				},
				{
					selector: 'variable',
					modifiers: ['const'],
					format: ['camelCase', 'UPPER_CASE'],
				},
				{
					selector: 'typeLike',
					format: ['StrictPascalCase'],
				},
				{
					selector: ['objectLiteralProperty', 'objectLiteralMethod'],
					format: null,
				},
				{
					selector: 'enumMember',
					format: ['StrictPascalCase'],
				},
				{
					selector: 'interface',
					format: ['StrictPascalCase'],
					prefix: ['I'],
				},
				{
					selector: 'typeParameter',
					format: ['StrictPascalCase'],
					prefix: ['T'],
				},
				{
					selector: 'typeProperty',
					format: ['camelCase', 'PascalCase'],
				},
				{
					selector: 'classProperty',
					modifiers: ['public', 'static', 'readonly'],
					format: ['UPPER_CASE'],
					leadingUnderscore: 'forbid',
				},
				{
					selector: 'classProperty',
					modifiers: ['protected', 'static', 'readonly'],
					format: ['UPPER_CASE'],
					leadingUnderscore: 'forbid',
				},
				{
					selector: 'classProperty',
					modifiers: ['private', 'static', 'readonly'],
					format: ['UPPER_CASE'],
					leadingUnderscore: 'require',
				},
				{
					selector: 'classProperty',
					modifiers: ['private'],
					format: ['camelCase'],
					leadingUnderscore: 'allow',
				},
				{
					selector: 'classMethod',
					modifiers: ['private'],
					format: ['camelCase'],
					leadingUnderscore: 'require',
				},
				{
					selector: 'parameter',
					format: ['camelCase', 'PascalCase'],
				},
				{
					selector: 'parameter',
					modifiers: ['unused'],
					format: ['camelCase'],
					leadingUnderscore: 'allow',
				},
			],
			'@typescript-eslint/restrict-template-expressions': [
				'warn',
				{
					allowNumber: true,
				},
			],

			// Enabled rules
			'@typescript-eslint/array-type': 'error',
			'@typescript-eslint/no-restricted-types': 'error',
			'@typescript-eslint/ban-ts-comment': 'error',
			'@typescript-eslint/explicit-function-return-type': 'error',
			'@typescript-eslint/typedef': [
				'error',
				{
					variableDeclaration: true,
					variableDeclarationIgnoreFunction: true,
				},
			],
			'@typescript-eslint/member-ordering': 'warn',
			'@typescript-eslint/no-confusing-void-expression': 'error',
			'@typescript-eslint/no-explicit-any': 'error',
			'@typescript-eslint/no-non-null-assertion': 'error',
			'@typescript-eslint/prefer-readonly': 'error',
			'@typescript-eslint/prefer-reduce-type-parameter': 'error',
			'@typescript-eslint/prefer-return-this-type': 'warn',
			'@typescript-eslint/require-await': 'error',
			'@typescript-eslint/require-array-sort-compare': 'warn',
			'@typescript-eslint/explicit-module-boundary-types': 'error',
			'@typescript-eslint/explicit-member-accessibility': 'error',
			'@typescript-eslint/no-floating-promises': 'error',
			'@typescript-eslint/no-misused-promises': 'error',
			'@typescript-eslint/await-thenable': 'error',
			'@typescript-eslint/no-unnecessary-type-assertion': 'error',
			'@typescript-eslint/parameter-properties': 'error',
			'@typescript-eslint/prefer-nullish-coalescing': 'error',
			'@typescript-eslint/prefer-optional-chain': 'error',
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					args: 'all',
					argsIgnorePattern: '^_',
					caughtErrors: 'all',
					caughtErrorsIgnorePattern: '^_',
					destructuredArrayIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					ignoreRestSiblings: true,
				},
			],
			'import-x/order': [
				'error',
				{
					groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
					'newlines-between': 'always',
					alphabetize: {
						order: 'asc',
						caseInsensitive: true,
					},
				},
			],
			'import-x/no-unresolved': 'error',
			'import-x/no-duplicates': 'error',
			'@typescript-eslint/strict-boolean-expressions': [
				'error',
				{
					allowNullableString: true,
				},
			],
			'@typescript-eslint/dot-notation': [
				'error',
				{
					allowIndexSignaturePropertyAccess: true,
				},
			],
			'@typescript-eslint/consistent-type-assertions': [
				'error',
				{
					assertionStyle: 'never',
				},
			],
			'@typescript-eslint/consistent-type-imports': [
				'error',
				{
					prefer: 'type-imports',
					disallowTypeAnnotations: false,
				},
			],
			'no-console': 'error',
			'no-param-reassign': [
				'error',
				{
					props: false,
				},
			],
		},
	},
	eslintConfigPrettier,
	{
		files: ['src/**/*.ts', 'tests/**/*.ts'],
		rules: {
			curly: ['error', 'all'],
		},
	},
	{
		ignores: ['dist/', 'eslint-rules/dist/', 'eslint.config.js'],
	},
);
