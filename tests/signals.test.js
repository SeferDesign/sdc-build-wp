import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { makeTheme, startWatch } from './helpers/index.js';

for (const [signal, exitCode] of [['SIGTERM', 143], ['SIGHUP', 129], ['SIGINT', 0]]) {
	test(`${signal} shuts watch mode down cleanly with exit code ${exitCode}`, { timeout: 40000 }, async t => {
		const root = await makeTheme(t);
		const { child, exited, getOutput } = await startWatch(t, root);
		child.kill(signal);
		const result = await exited;
		assert.deepEqual(result, { code: exitCode, signal: null }, getOutput());
		assert.match(getOutput(), /Exited sdc-build-wp/);
		// The cache manifest is flushed before exiting.
		const manifest = JSON.parse(await fs.readFile(path.join(root, '.sdc-build-wp/cache/manifest.json'), 'utf8'));
		assert.ok(Object.keys(manifest.entries).length > 0);
	});
}

test('a repeated termination signal exits immediately', { timeout: 40000 }, async t => {
	const root = await makeTheme(t);
	const { child, exited, getOutput } = await startWatch(t, root);
	child.kill('SIGTERM');
	child.kill('SIGTERM');
	const result = await exited;
	assert.equal(result.signal, null, getOutput());
	assert.equal(result.code, 143, getOutput());
});
