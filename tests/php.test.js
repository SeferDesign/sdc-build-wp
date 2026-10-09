import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import project from '../lib/project.js';
import PHPComponent from '../lib/components/php.js';

const execFileAsync = promisify(execFile);

for (const customGlob of [false, true]) {
	test(`PHP watcher discovers new files ${customGlob ? 'with a custom glob' : 'in an initially empty project'}`, { timeout: 10000 }, async t => {
		const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-php-watch-')));
		t.after(() => fs.rm(root, { recursive: true, force: true }));
		const component = new PHPComponent();
		component.project = {
			...project,
			path: root,
			config: customGlob ? { phpGlobPath: `${root}/templates/**/render-*.php` } : {},
			isRunning: true,
			chokidarOpts: { ignoreInitial: true, ignored: [path.join(root, 'vendor')] }
		};
		await component.init();
		assert.deepEqual(component.globs, []);
		const processed = [];
		let notify;
		t.mock.method(component, 'process', async entry => {
			processed.push(entry);
			notify?.(entry);
		});
		component.watch();
		t.after(() => component.watcher.close());
		await once(component.watcher, 'ready');
		await new Promise(resolve => setTimeout(resolve, 300));
		const waitForEntry = entry => new Promise(resolve => {
			notify = file => {
				if (file === entry) { resolve(); }
			};
		});
		const directory = path.join(root, customGlob ? 'templates/nested' : 'nested');
		await fs.mkdir(directory, { recursive: true });
		const entry = path.join(directory, 'render-new.php');
		let handled = waitForEntry(entry);
		await fs.writeFile(entry, '<?php\n');
		await handled;
		assert.ok(component.globs.includes(entry));

		handled = waitForEntry(entry);
		await fs.writeFile(entry, '<?php\n// changed\n');
		await handled;
		assert.ok(processed.filter(file => file === entry).length >= 2);

		const ignored = [
			path.join(root, 'vendor/ignored.php'),
			path.join(root, 'blocks/example/build/render.php'),
			path.join(directory, 'notes.txt'),
			...(customGlob ? [path.join(directory, 'other.php'), path.join(root, 'outside.php')] : [])
		];
		for (const file of ignored) {
			await fs.mkdir(path.dirname(file), { recursive: true });
			await fs.writeFile(file, '<?php\n');
		}
		const second = path.join(directory, 'render-second.php');
		handled = waitForEntry(second);
		await fs.writeFile(second, '<?php\n');
		await handled;
		await new Promise(resolve => setTimeout(resolve, 200));
		assert.ok(ignored.every(file => !processed.includes(file) && !component.globs.includes(file)));

		const removed = new Promise(resolve => component.watcher.on('unlink', file => {
			if (file === entry) { resolve(); }
		}));
		const count = processed.length;
		await fs.unlink(entry);
		await removed;
		await component.watchPending;
		assert.equal(processed.length, count);
		assert.ok(!component.globs.includes(entry));
	});
}

test('block PHP is formatted quietly, ignores coding-standard violations, and rejects syntax errors', { timeout: 30000 }, async t => {
	await execFileAsync('php', ['--version']);
	await fs.access(new URL('../vendor/bin/php-cs-fixer', import.meta.url));
	const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-php-')));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	await fs.cp(new URL('./fixtures/theme/', import.meta.url), root, { recursive: true });
	const entry = path.join(root, 'blocks/fixture/render.php');
	const source = await fs.readFile(entry, 'utf8');
	const run = async lintType => {
		const code = `
			import project from ${JSON.stringify(new URL('../lib/project.js', import.meta.url).href)};
			import PHPComponent from ${JSON.stringify(new URL('../lib/components/php.js', import.meta.url).href)};
			const component = new PHPComponent();
			await component.init();
			if (!component.globs.includes(${JSON.stringify(entry)})) throw new Error('Block PHP was not discovered');
			const result = await component.build(${JSON.stringify(entry)}, { lintType: ${JSON.stringify(lintType)} });
			if (result === false) process.exitCode = 1;
		`;
		return execFileAsync(process.execPath, ['--input-type=module', '-e', code], {
			cwd: root,
			timeout: 15000,
			env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }
		});
	};
	assert.match((await run('warn')).stdout, /Linted \(warn\).*blocks\/fixture\/render.php/);
	assert.equal(await fs.readFile(entry, 'utf8'), source);

	await fs.writeFile(entry, source.replace('$message = \'Fixture block\';', '$message   =   \'Fixture block\';'));
	assert.match((await run('fix')).stdout, /Linted \(fix\)/);
	assert.equal(await fs.readFile(entry, 'utf8'), source);

	const invalidSource = '<?php\n$message = ;\n';
	await fs.writeFile(entry, invalidSource);
	for (const lintType of ['warn', 'fix']) {
		await assert.rejects(run(lintType), error => {
			assert.equal(error.code, 1);
			assert.match(error.stdout + error.stderr, /Failed to validate/);
			assert.doesNotMatch(error.stdout + error.stderr, /Linted \(/);
			return true;
		});
		assert.equal(await fs.readFile(entry, 'utf8'), invalidSource);
	}

	const codingStandardSource = '<?php\nfunction register_enqueue($unused) {\n\t$message   =   \'fixture\';\n\tvar_dump($message);\n}\n';
	await fs.writeFile(entry, codingStandardSource);
	for (const lintType of ['warn', 'fix']) {
		const { stdout, stderr } = await run(lintType);
		assert.match(stdout, /Linted \(/);
		assert.doesNotMatch(stdout + stderr, /FOUND \d+ ERRORS|WARNING|var_dump|camel caps|never used|Failed/);
		assert.equal(await fs.readFile(entry, 'utf8'), lintType === 'fix'
			? codingStandardSource.replace('$message   =   ', '$message = ')
			: codingStandardSource);
	}
});
