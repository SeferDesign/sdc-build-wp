import { defineConfig } from 'eslint/config';
import stylistic from '@stylistic/eslint-plugin';

export default defineConfig([
	{
		plugins: {
			'@stylistic': stylistic
		},
		languageOptions: {
			parserOptions: {
				ecmaVersion: 'latest',
				sourceType: 'module',
				ecmaFeatures: {
					jsx: true
				}
			}
		},
		rules: {
			semi: 1,
			indent: [1, 'tab'],
			'no-multiple-empty-lines': [
				1,
				{
					max: 1
				}
			],
			'no-var': 2,
			'prefer-const': 2,
			'@stylistic/quotes': [1, 'single']
		}
	}
]);
