import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import project from '../lib/project.js';
import { runDoctor } from '../lib/doctor.js';

test('doctor validates configuration and entries without building or migrating files', async t => {
	assert.ok(project);
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-doctor-'));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	const manifest = JSON.stringify({ name: 'doctor-fixture', sdc: { php: { enabled: false } } });
	await fs.writeFile(path.join(root, 'package.json'), manifest);
	const cli = new URL('../index.js', import.meta.url).pathname;
	const { stdout } = await promisify(execFile)(process.execPath, [cli, '--doctor', '--builds=scripts'], { cwd: root, timeout: 10000 });
	assert.match(stdout, /Node:|Configuration:/);
	assert.equal(await fs.readFile(path.join(root, 'package.json'), 'utf8'), manifest);
	assert.deepEqual(await fs.readdir(root), ['package.json']);
	await fs.mkdir(path.join(root, '.sdc-build-wp'));
	await fs.writeFile(path.join(root, '.sdc-build-wp/config.json'), JSON.stringify({ entries: { main: ['/missing.js'] } }));
	const checks = await runDoctor({ root, builds: ['scripts'] });
	assert.ok(checks.some(check => check.status === 'error' && check.name === 'Entry main'));
	await fs.writeFile(path.join(root, '.sdc-build-wp/config.json'), '{');
	await assert.rejects(promisify(execFile)(process.execPath, [cli, 'doctor'], { cwd: root, timeout: 10000 }), error => {
		assert.equal(error.code, 1);
		assert.match(error.stderr, /Fix .sdc-build-wp\/config.json/);
		return true;
	});
});

test('doctor checks proxy responses, occupied ports and incomplete TLS configuration', async t => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-doctor-server-'));
	const server = createServer((request, response) => response.end());
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	t.after(async () => {
		await new Promise(resolve => server.close(resolve));
		await fs.rm(root, { recursive: true, force: true });
	});
	const port = server.address().port;
	const checks = await runDoctor({ root, builds: ['server'], legacyConfig: { port, browsersync: { localProxyURL: `http://127.0.0.1:${port}` } }, environment: { SSL_KEY_PATH: 'missing' } });
	assert.ok(checks.some(check => check.name === 'Port' && check.status === 'error'));
	assert.ok(checks.some(check => check.name === 'Proxy' && check.status === 'pass'));
	assert.ok(checks.some(check => check.name === 'TLS' && check.status === 'error'));
});
