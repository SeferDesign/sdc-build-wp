import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

test('block PHP passes lint, is formatted, and rejects syntax and coding-standard errors', { timeout: 30000 }, async t => {
	await execFileAsync('php', ['--version']);
	await fs.access(new URL('../vendor/bin/phpcs', import.meta.url));
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

	await fs.writeFile(entry, '<?php\n$message = ;\n');
	await assert.rejects(run('warn'), error => {
		assert.equal(error.code, 1);
		assert.match(error.stdout + error.stderr, /Failed to validate/);
		assert.doesNotMatch(error.stdout + error.stderr, /Linted \(/);
		return true;
	});

	await fs.writeFile(entry, '<?php\nvar_dump(\'fixture\');\n');
	await assert.rejects(run('warn'), error => {
		assert.equal(error.code, 1);
		assert.match(error.stdout + error.stderr, /var_dump/);
		assert.match(error.stdout + error.stderr, /Failed linting/);
		assert.doesNotMatch(error.stdout + error.stderr, /Linted \(/);
		return true;
	});
});
