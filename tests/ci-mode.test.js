import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { makeTheme, run } from './helpers/index.js';

const writeSource = (root, file, content) => fs.writeFile(path.join(root, file), content);

test('--production overrides the environment: no source maps are written', async t => {
	const root = await makeTheme(t);
	const { code, output } = await run(root, ['--builds=style,scripts', '--production'], { NODE_ENV: 'development' });
	assert.equal(code, 0, output);
	for (const file of ['dist/style/main.min.css', 'dist/scripts/main.min.js']) {
		await fs.access(path.join(root, file));
		await assert.rejects(fs.access(path.join(root, `${file}.map`)), { code: 'ENOENT' });
	}
	assert.equal(JSON.parse(await fs.readFile(path.join(root, '.sdc-build-wp/cache/manifest.json'), 'utf8')).environment, 'production');
});

test('--json prints one JSON summary on stdout and sends logs to stderr', async t => {
	const root = await makeTheme(t);
	const { code, stdout, stderr } = await run(root, ['--builds=style', '--json']);
	assert.equal(code, 0, stderr);
	const summary = JSON.parse(stdout);
	assert.equal(summary.success, true);
	assert.deepEqual(summary.errors, []);
	assert.ok(summary.components.includes('style'));
	assert.equal(typeof summary.durationMs, 'number');
	assert.ok(summary.warnings.some(entry => /WordPress validation/.test(entry.message)), 'warnings are structured');
	assert.match(stderr, /Built .*main\.min\.css/);
});

test('--json reports failures with a nonzero exit code and uncolored messages', async t => {
	const root = await makeTheme(t);
	await writeSource(root, '_src/style/main.scss', '.broken { color: $missing; }\n');
	const { code, stdout } = await run(root, ['--builds=style', '--json'], { FORCE_COLOR: '1', NO_COLOR: '' });
	assert.equal(code, 1);
	const summary = JSON.parse(stdout);
	assert.equal(summary.success, false);
	assert.ok(summary.errors.length > 0);
	assert.ok(summary.errors.every(entry => !entry.message.includes('\u001b[')));
});

test('--json still emits a summary when validation aborts the build', async t => {
	const root = await makeTheme(t, { wordpress: true });
	const themePath = path.join(root, 'theme.json');
	await fs.writeFile(themePath, JSON.stringify({ ...JSON.parse(await fs.readFile(themePath, 'utf8')), version: 'x' }));
	const { code, stdout } = await run(root, ['--builds=style', '--json', '--no-cache']);
	assert.equal(code, 1);
	assert.equal(JSON.parse(stdout).success, false);
});

test('--ci fails on warnings but --skip-validation leaves a clean build', async t => {
	const root = await makeTheme(t);
	const noisy = await run(root, ['--builds=style,scripts', '--ci']);
	assert.equal(noisy.code, 1, noisy.output);
	assert.match(noisy.output, /warning\(s\) reported in --ci mode/);

	const clean = await run(root, ['--builds=style,scripts', '--ci', '--skip-validation']);
	assert.equal(clean.code, 0, clean.output);
	assert.doesNotMatch(clean.output, /--ci mode/);
});

test('--ci checks lint without rewriting sources while normal builds auto-fix', async t => {
	const root = await makeTheme(t);
	const source = '_src/scripts/main.js';
	const unformatted = 'import { message } from "./message.js";\nexport const getMessage = () => message;\n';
	await writeSource(root, source, unformatted);

	const ci = await run(root, ['--builds=scripts', '--ci', '--skip-validation', '--no-cache']);
	assert.equal(ci.code, 1, ci.output);
	assert.match(ci.output, /does not auto-fix/);
	assert.equal(await fs.readFile(path.join(root, source), 'utf8'), unformatted);

	const normal = await run(root, ['--builds=scripts', '--skip-validation', '--no-cache']);
	assert.equal(normal.code, 0, normal.output);
	assert.match(await fs.readFile(path.join(root, source), 'utf8'), /from 'message\.js'|from '\.\/message\.js'/);
});

test('unfixable Stylelint errors fail one-shot builds', async t => {
	const root = await makeTheme(t);
	await writeSource(root, '_src/style/main.scss', '.a { color: red; }\n');
	const { code, output } = await run(root, ['--builds=style', '--skip-validation', '--no-cache']);
	assert.equal(code, 1, output);
	assert.match(output, /Style lint errors remain/);
	await assert.rejects(fs.access(path.join(root, 'dist/style/main.min.css')), { code: 'ENOENT' });
});

test('--ci and --json cannot be combined with --watch', async t => {
	const root = await makeTheme(t);
	for (const flag of ['--ci', '--json']) {
		const { code, output } = await run(root, ['--watch', flag]);
		assert.equal(code, 1);
		assert.match(output, /cannot be combined with --watch/);
	}
});
