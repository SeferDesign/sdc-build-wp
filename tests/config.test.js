import assert from 'node:assert/strict';
import { test } from 'node:test';
import project from '../lib/project.js';
import { validateConfig, getDefaultConfig, mergeWithDefaults } from '../lib/config-validator.js';

test('config accepts defaults and typed overrides without mutating defaults', () => {
	assert.ok(project);
	assert.equal(validateConfig({}), true);
	assert.equal(validateConfig({
		imagesPath: '_src/images',
		errorLogPath: 'debug.log',
		entries: { main: ['/main.js'] },
		buildConcurrency: { total: 2, scripts: 1 },
		php: { enabled: false }
	}), true);
	const defaults = getDefaultConfig();
	const merged = mergeWithDefaults({ php: { enabled: false }, errorLogPath: 'custom.log' });
	assert.deepEqual(merged.errorLogPaths, ['custom.log']);
	assert.equal(merged.php.enabled, false);
	assert.equal(defaults.php.enabled, true);
	assert.deepEqual(mergeWithDefaults({}).errorLogPaths, defaults.errorLogPaths);
	assert.deepEqual(mergeWithDefaults({ errorLogPath: null }).errorLogPaths, defaults.errorLogPaths);
});

for (const [name, config] of [
	['image path', { imagesPath: 42 }],
	['error log path', { errorLogPath: [] }],
	['entries', { entries: [] }],
	['concurrency', { buildConcurrency: { total: 'two' } }],
	['PHP enabled', { php: { enabled: 'yes' } }]
]) {
	test(`config rejects invalid ${name} and reports the error`, t => {
		const output = [];
		t.mock.method(console, 'log', value => output.push(String(value)));
		t.mock.method(console, 'error', value => output.push(String(value)));
		assert.equal(validateConfig(config), false);
		assert.match(output.join('\n'), /expected .* got/);
		assert.match(output.join('\n'), /Configuration validation failed/);
	});
}

test('unknown nested config keys warn but remain compatible', t => {
	const output = [];
	t.mock.method(console, 'warn', value => output.push(String(value)));
	assert.equal(validateConfig({ php: { enabled: null, futureOption: true } }), true);
	assert.match(output.join('\n'), /php.futureOption/);
});
