import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { validateConfig, mergeWithDefaults } from '../lib/config-validator.js';
import { makeTheme, run, writeConfig } from './helpers/index.js';

// A theme.json that violates the offline test schema (version must be an integer).
async function breakTheme(root) {
	const themePath = path.join(root, 'theme.json');
	const theme = JSON.parse(await fs.readFile(themePath, 'utf8'));
	theme.version = 'three';
	await fs.writeFile(themePath, JSON.stringify(theme));
}

test('validation settings are schema-checked and merged with defaults', () => {
	assert.equal(validateConfig({ validation: { enabled: false, failOn: 'never' } }), true);
	for (const validation of [{ failOn: 'sometimes' }, { enabled: 'no' }, { typo: true }, null]) {
		assert.equal(validateConfig({ validation }), false, JSON.stringify(validation));
	}
	assert.deepEqual(mergeWithDefaults({}).validation, { enabled: true, failOn: 'error' });
	assert.deepEqual(mergeWithDefaults({ validation: { failOn: 'never' } }).validation, { enabled: true, failOn: 'never' });
});

test('invalid metadata fails the build by default', async t => {
	const root = await makeTheme(t, { wordpress: true });
	await breakTheme(root);
	const { code, output } = await run(root, ['--builds=style', '--no-cache']);
	assert.equal(code, 1, output);
	assert.match(output, /theme\.json/);
});

test('--skip-validation builds despite invalid metadata and never needs WordPress or schemas', async t => {
	const root = await makeTheme(t, { wordpress: true });
	await breakTheme(root);
	const flagged = await run(root, ['--builds=style', '--no-cache', '--skip-validation']);
	assert.equal(flagged.code, 0, flagged.output);
	assert.match(flagged.output, /Skipped WordPress validation/);
	assert.doesNotMatch(flagged.output, /theme\.json/);

	// No WordPress install and no schema cache: validation would try the network.
	const bare = await makeTheme(t);
	await writeConfig(bare, { entries: { 'style/main': ['/_src/style/main.scss'] }, validation: { enabled: false } });
	const configured = await run(bare, ['--builds=style']);
	assert.equal(configured.code, 0, configured.output);
	assert.match(configured.output, /Skipped WordPress validation/);
});

test('validation.failOn "never" reports problems as warnings and the build still succeeds', async t => {
	const root = await makeTheme(t, { wordpress: true });
	await breakTheme(root);
	await writeConfig(root, { entries: { 'style/main': ['/_src/style/main.scss'] }, validation: { failOn: 'never' } });
	const { code, output } = await run(root, ['--builds=style', '--no-cache']);
	assert.equal(code, 0, output);
	assert.match(output, /⚠.*theme\.json/);
	assert.doesNotMatch(output, /✖/);
	await fs.access(path.join(root, 'dist/style/main.min.css'));
});

test('failOn "never" also tolerates schema download failures', async t => {
	const root = await makeTheme(t, { wordpress: true });
	await fs.rm(path.join(root, '.sdc-build-wp/cache/schemas'), { recursive: true });
	await fs.writeFile(path.join(root, 'wp-includes/version.php'), '<?php\n$wp_version = "0.0";');
	await writeConfig(root, { entries: { 'style/main': ['/_src/style/main.scss'] }, validation: { failOn: 'never' } });
	const { code, output } = await run(root, ['--builds=style', '--no-cache'], { HTTPS_PROXY: 'http://127.0.0.1:9', NODE_USE_ENV_PROXY: '1' });
	assert.equal(code, 0, output);
	assert.match(output, /Cannot load WordPress 0\.0/);
});
