import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateConfig } from '../lib/config-validator.js';
import { getConfigTemplate, initProject, ensureSourceDirectory } from '../lib/init.js';
import { runDoctor } from '../lib/doctor.js';
import { run } from './helpers/index.js';

async function emptyProject(t, packageJson = { name: 'fresh-theme' }) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-init-'));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(packageJson));
	return root;
}

const exists = file => fs.access(file).then(() => true, () => false);
const read = (root, file) => fs.readFile(path.join(root, file), 'utf8');

test('the config template is a valid configuration that points at the packaged schema', () => {
	const template = getConfigTemplate();
	assert.equal(template.$schema, '../node_modules/sdc-build-wp/config.schema.json');
	assert.equal(validateConfig(template), true);
});

test('init scaffolds a configuration and source folders that build immediately', async t => {
	const root = await emptyProject(t);
	const { code, output } = await run(root, ['init']);
	assert.equal(code, 0, output);
	assert.match(output, /config\.json: Created configuration/);
	assert.deepEqual(JSON.parse(await read(root, '.sdc-build-wp/config.json')), getConfigTemplate());
	assert.match(await read(root, '_src/style/main.scss'), /Theme styles/);
	assert.match(await read(root, '_src/scripts/main.js'), /Theme scripts/);
	for (const directory of ['images', 'fonts']) {
		assert.equal(await exists(path.join(root, '_src', directory, '.gitkeep')), true);
	}

	const build = await run(root, ['--builds=style,scripts,images,fonts', '--skip-validation']);
	assert.equal(build.code, 0, build.output);
	assert.equal(await exists(path.join(root, 'dist/style/main.min.css')), true);
	assert.equal(await exists(path.join(root, 'dist/scripts/main.min.js')), true);
});

test('init never overwrites existing work unless forced', async t => {
	const root = await emptyProject(t);
	await fs.mkdir(path.join(root, '.sdc-build-wp'));
	await fs.writeFile(path.join(root, '.sdc-build-wp/config.json'), '{"port":4000}');
	await fs.mkdir(path.join(root, '_src/style'), { recursive: true });
	await fs.writeFile(path.join(root, '_src/style/main.scss'), '.mine { display: block; }\n');
	await fs.mkdir(path.join(root, '_src/scripts'), { recursive: true });

	const rerun = await run(root, ['init']);
	assert.equal(rerun.code, 0, rerun.output);
	assert.match(rerun.output, /Configuration already exists/);
	assert.equal(await read(root, '.sdc-build-wp/config.json'), '{"port":4000}');
	assert.equal(await read(root, '_src/style/main.scss'), '.mine { display: block; }\n');
	assert.match(rerun.output, /_src\/scripts\/main\.js: Added starter file to the empty directory/);

	const forced = await run(root, ['init', '--force']);
	assert.equal(forced.code, 0, forced.output);
	assert.deepEqual(JSON.parse(await read(root, '.sdc-build-wp/config.json')), getConfigTemplate());
	assert.equal(await read(root, '_src/style/main.scss'), '.mine { display: block; }\n');
});

test('init leaves legacy package.json settings for the next build to migrate', async t => {
	const root = await emptyProject(t, { name: 'legacy', sdc: { port: 3100 } });
	const { code, output } = await run(root, ['init']);
	assert.equal(code, 0, output);
	assert.match(output, /legacy "sdc" settings/);
	assert.equal(await exists(path.join(root, '.sdc-build-wp/config.json')), false);
	assert.equal(await exists(path.join(root, '_src/style/main.scss')), true);
});

test('initProject reports created and skipped paths', async t => {
	const root = await emptyProject(t);
	const first = await initProject({ root });
	assert.ok(first.every(result => result.status === 'created'), JSON.stringify(first));
	assert.deepEqual(first.map(result => result.path), ['.sdc-build-wp/config.json', '_src/style/', '_src/scripts/', '_src/images/', '_src/fonts/']);
	const second = await initProject({ root });
	assert.ok(second.every(result => result.status === 'skipped'), JSON.stringify(second));
	assert.deepEqual(await ensureSourceDirectory(root, 'style'), { directory: path.join(root, '_src/style'), created: false, starter: null });
});

test('doctor --fix creates the missing configuration and source directories', async t => {
	const root = await emptyProject(t);
	const before = await run(root, ['doctor', '--builds=style,scripts,images,fonts']);
	assert.match(before.output, /No configuration file/);
	assert.match(before.output, /Source directory is missing: _src\/style/);
	assert.equal(await exists(path.join(root, '.sdc-build-wp/config.json')), false);

	const fixed = await run(root, ['doctor', '--fix', '--builds=style,scripts,images,fonts']);
	assert.equal(fixed.code, 0, fixed.output);
	assert.match(fixed.output, /Configuration: Fixed: Created \.sdc-build-wp\/config\.json/);
	assert.match(fixed.output, /style sources: Fixed: Created _src\/style/);
	for (const directory of ['style', 'scripts', 'images', 'fonts']) {
		assert.equal((await fs.stat(path.join(root, '_src', directory))).isDirectory(), true);
	}

	const after = await run(root, ['doctor', '--builds=style,scripts,images,fonts']);
	assert.doesNotMatch(after.output, /Source directory is missing|No configuration file/);
	assert.match(after.output, /Configuration: Configuration matches the published schema/);
});

test('doctor without --fix changes nothing and --fix requires doctor', async t => {
	const root = await emptyProject(t);
	await run(root, ['doctor']);
	assert.deepEqual(await fs.readdir(root), ['package.json']);
	const { code, output } = await run(root, ['--fix', '--builds=style']);
	assert.equal(code, 1);
	assert.match(output, /--fix can only be used with doctor/);
});

test('doctor --fix reports a failed repair instead of crashing', async t => {
	const root = await emptyProject(t);
	await fs.writeFile(path.join(root, '_src'), 'a file where the directory should be');
	const checks = await runDoctor({ root, builds: ['style'], fix: true });
	const style = checks.find(check => check.name === 'style sources');
	assert.equal(style.status, 'warn');
	assert.match(style.message, /automatic fix failed/);
	assert.ok(checks.every(check => !('remedy' in check)));
});

test('doctor never repairs legacy settings or schema errors', async t => {
	const root = await emptyProject(t);
	const legacy = await runDoctor({ root, builds: [], legacyConfig: { port: 3100 }, fix: true });
	assert.equal(legacy.find(check => check.name === 'Configuration').status, 'warn');
	assert.equal(await exists(path.join(root, '.sdc-build-wp/config.json')), false);
	await fs.mkdir(path.join(root, '.sdc-build-wp'));
	await fs.writeFile(path.join(root, '.sdc-build-wp/config.json'), '{"typo":true}');
	const invalid = await runDoctor({ root, builds: [], fix: true });
	assert.equal(invalid.find(check => check.name === 'Configuration').status, 'error');
	assert.equal(await read(root, '.sdc-build-wp/config.json'), '{"typo":true}');
});
