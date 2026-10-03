import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';

const execFileAsync = promisify(execFile);
const cli = fileURLToPath(new URL('../index.js', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/theme/', import.meta.url));

test('watch mode rebuilds fixture scripts without the server component', { timeout: 30000 }, async t => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-watch-'));
	await fs.cp(fixture, root, { recursive: true });
	const child = spawn(process.execPath, [cli, '--builds=scripts', '--watch', '--no-cache'], {
		cwd: root,
		stdio: ['pipe', 'pipe', 'pipe'],
		env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }
	});
	let output = '';
	child.stdout.on('data', chunk => { output += chunk; });
	child.stderr.on('data', chunk => { output += chunk; });
	const exited = new Promise((resolve, reject) => {
		child.once('error', reject);
		child.once('exit', (code, signal) => resolve({ code, signal }));
	});
	t.after(async () => {
		if (child.exitCode === null && child.signalCode === null) {
			child.kill('SIGKILL');
		}
		await exited;
		await fs.rm(root, { recursive: true, force: true });
	});
	const waitFor = async predicate => {
		const deadline = Date.now() + 15000;
		while (!predicate()) {
			assert.equal(child.exitCode, null, output);
			assert.equal(child.signalCode, null, output);
			assert.ok(Date.now() < deadline, output);
			await new Promise(resolve => setTimeout(resolve, 25));
		}
	};
	await waitFor(() => output.includes('Started watching [scripts]'));
	// Chokidar's initial scan must finish before changing a dependency.
	await new Promise(resolve => setTimeout(resolve, 300));
	const beforeChange = output.length;
	await fs.writeFile(path.join(root, '_src/scripts/message.js'), 'export const message = \'watch-updated\';\n');
	await waitFor(() => output.slice(beforeChange).includes('Built /dist/scripts/main.min.js'));
	const bundle = await fs.readFile(path.join(root, 'dist/scripts/main.min.js'), 'utf8');
	assert.equal(runInNewContext(`${bundle}; sdcBuild.getMessage()`), 'watch-updated');
	assert.doesNotMatch(output, /Failed|Uncaught|Unhandled|✖/);
	child.kill('SIGINT');
	await waitFor(() => child.exitCode !== null);
	assert.deepEqual(await exited, { code: 0, signal: null });
});

test('test theme builds through the CLI, reuses cache, and rebuilds changed or missing outputs', { timeout: 120000 }, async t => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-theme-'));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	await fs.cp(fixture, root, {
		recursive: true,
		filter: source => ![
			'dist',
			path.join('.sdc-build-wp', 'cache'),
			path.join('_src', 'style', 'partials', '_theme.scss')
		].includes(path.relative(fixture, source))
	});
	const build = async (...args) => {
		const { stdout, stderr } = await execFileAsync(process.execPath, [cli, '--builds=style,scripts,images', ...args], {
			cwd: root,
			timeout: 30000,
			maxBuffer: 4 * 1024 * 1024,
			env: { ...process.env, NODE_ENV: 'development', NO_COLOR: '1', FORCE_COLOR: '0' }
		});
		assert.doesNotMatch(stdout + stderr, /Failed|Continuing without failed components|Uncaught|Unhandled|✖/, stdout + stderr);
		assert.match(stdout, /Finished initial build/);
		return stdout;
	};
	const cssPath = path.join(root, 'dist/style/main.min.css');
	const scriptPath = path.join(root, 'dist/scripts/main.min.js');
	const read = relative => fs.readFile(path.join(root, relative), 'utf8');
	const bundleMessage = async () => runInNewContext(`${await read('dist/scripts/main.min.js')}; sdcBuild.getMessage()`);

	await build();
	assert.match(await read('dist/style/main.min.css'), /\.fixture\{color:#123456;display:flex\}/);
	assert.equal(await bundleMessage(), 'fixture-original');
	assert.equal(JSON.parse(await read('dist/scripts/main.min.js.map')).version, 3);
	assert.equal(JSON.parse(await read('dist/style/main.min.css.map')).version, 3);
	assert.match(await read('_src/style/partials/_theme.scss'), /\$brand: #123456/);
	assert.match(await read('dist/images/icon.svg'), /<svg/);
	const manifest = JSON.parse(await read('.sdc-build-wp/cache/manifest.json'));
	assert.equal(Object.keys(manifest.entries).length, 2);
	for (const entry of Object.values(manifest.entries)) {
		assert.ok(Object.keys(entry.dependencies).length > 0);
	}
	const initialCSS = await fs.stat(cssPath);
	const initialScript = await fs.stat(scriptPath);

	const warmOutput = await build();
	assert.match(warmOutput, /main\.min\.css \(cached\)/);
	assert.match(warmOutput, /main\.min\.js \(cached\)/);
	assert.equal((await fs.stat(cssPath)).mtimeMs, initialCSS.mtimeMs);
	assert.equal((await fs.stat(scriptPath)).mtimeMs, initialScript.mtimeMs);

	await fs.writeFile(path.join(root, '_src/style/partials/_tokens.scss'), '$accent: #654321;\n');
	await fs.writeFile(path.join(root, '_src/scripts/message.js'), 'export const message = \'fixture-updated\';\n');
	const updatedOutput = await build();
	assert.doesNotMatch(updatedOutput, /main\.min\.(css|js) \(cached\)/);
	assert.match(await read('dist/style/main.min.css'), /color:#654321/);
	assert.equal(await bundleMessage(), 'fixture-updated');

	await fs.rm(cssPath);
	await fs.rm(scriptPath);
	const missingOutput = await build();
	assert.doesNotMatch(missingOutput, /main\.min\.(css|js) \(cached\)/);
	assert.match(await read('dist/style/main.min.css'), /color:#654321/);
	assert.equal(await bundleMessage(), 'fixture-updated');

	const uncachedOutput = await build('--no-cache');
	assert.doesNotMatch(uncachedOutput, /\(cached\)/);
	assert.equal(await bundleMessage(), 'fixture-updated');
});
