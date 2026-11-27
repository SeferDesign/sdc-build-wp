import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { cli, makeTheme } from './helpers/index.js';

// Starts a watch session and resolves once it is watching.
async function startWatch(t, root) {
	const child = spawn(process.execPath, [cli, '--builds=style,scripts', '--watch', '--skip-validation'], {
		cwd: root, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }
	});
	let output = '';
	child.stdout.on('data', chunk => { output += chunk; });
	child.stderr.on('data', chunk => { output += chunk; });
	const exited = new Promise((resolve, reject) => {
		child.once('error', reject);
		child.once('exit', (code, signal) => resolve({ code, signal }));
	});
	t.after(async () => {
		if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); }
		await exited;
	});
	const deadline = Date.now() + 20000;
	while (!/Started watching/.test(output)) {
		assert.equal(child.exitCode, null, output);
		assert.ok(Date.now() < deadline, output);
		await new Promise(resolve => setTimeout(resolve, 50));
	}
	return { child, exited, getOutput: () => output };
}

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
