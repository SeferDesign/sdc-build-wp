import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { makeTheme, run, writeConfig } from './helpers/index.js';

const execFileAsync = promisify(execFile);
const moduleUrl = file => JSON.stringify(pathToFileURL(new URL(`../lib/${file}`, import.meta.url).pathname).href);
const exists = file => fs.access(file).then(() => true, () => false);

// Runs a script against the real project singleton from inside `root`, as the CLI would.
async function runScript(root, body) {
	const prelude = `import project, { init, keypressListen } from ${moduleUrl('project.js')};
import tui from ${moduleUrl('tui.js')};\n`;
	try {
		const { stdout, stderr } = await execFileAsync(process.execPath, ['--input-type=module', '-e', prelude + body], {
			cwd: root, timeout: 30000, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }
		});
		return { code: 0, output: stdout + stderr };
	} catch (error) {
		return { code: error.code, output: `${error.stdout}${error.stderr}` };
	}
}

async function plainProject(t, extra = {}) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-lifecycle-'));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'lifecycle', ...extra }));
	return root;
}

test('legacy package.json sdc settings are migrated into the config file on the next build', async t => {
	const root = await makeTheme(t);
	await fs.rm(path.join(root, '.sdc-build-wp'), { recursive: true });
	const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
	packageJson.sdc = { entries: { 'style/main': ['/_src/style/main.scss'] }, php: { enabled: false } };
	await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(packageJson));

	const { code, output } = await run(root, ['--builds=style', '--skip-validation']);
	assert.equal(code, 0, output);
	assert.match(output, /Converted package\.json sdc to \.sdc-build-wp\/config\.json/);
	assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, '.sdc-build-wp/config.json'), 'utf8')), packageJson.sdc);
	assert.equal(JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).sdc, undefined);
	assert.equal(await exists(path.join(root, 'dist/style/main.min.css')), true);
});

test('--clear-cache removes cached data and exits without building', async t => {
	const root = await makeTheme(t);
	assert.equal((await run(root, ['--builds=style', '--skip-validation'])).code, 0);
	assert.equal(await exists(path.join(root, '.sdc-build-wp/cache/manifest.json')), true);
	await fs.rm(path.join(root, 'dist'), { recursive: true });

	const { code, output } = await run(root, ['--clear-cache']);
	assert.equal(code, 0, output);
	assert.match(output, /Cache cleared/);
	assert.equal(await exists(path.join(root, '.sdc-build-wp/cache/manifest.json')), false);
	assert.equal(await exists(path.join(root, 'dist')), false, 'nothing was built');
});

test('a cache that cannot initialize is a warning and the build continues uncached', async t => {
	const root = await makeTheme(t);
	await fs.writeFile(path.join(root, '.sdc-build-wp/cache'), 'a file where the cache directory belongs');
	const { code, output } = await run(root, ['--builds=style', '--skip-validation']);
	assert.equal(code, 0, output);
	assert.match(output, /Failed to initialize cache/);
	assert.equal(await exists(path.join(root, 'dist/style/main.min.css')), true);
});

test('a component that fails to initialize is dropped while the rest still build', async t => {
	const root = await makeTheme(t);
	await writeConfig(root, { entries: { 'style/main': ['/_src/style/main.scss'] }, imagesPath: 'package.json' });
	const { code, output } = await run(root, ['--builds=style,images', '--skip-validation']);
	assert.equal(code, 1, output);
	assert.match(output, /Failed to initialize images component/);
	assert.match(output, /Continuing without failed components: images/);
	assert.equal(await exists(path.join(root, 'dist/style/main.min.css')), true);
});

test('interactive commands create blocks, patterns and style variations and validate names', async t => {
	const root = await plainProject(t);
	const { code, output } = await runScript(root, `
await init();
Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
keypressListen();
project.components.blocks.addBlock = dir => console.log('ADDBLOCK ' + dir.split('/').pop());
tui.showInfo = () => console.log('SHOWINFO');
for (const creation of [
	{ type: 'Block', name: 'My Block' },
	{ type: 'Pattern', name: 'Hero Section' },
	{ type: 'Style variation', name: 'Dark Mode' },
	{ type: 'Block', name: 'My Block' },
	{ type: 'Pattern', name: 'Hero Section' },
	{ type: 'Style variation', name: 'Dark Mode' },
	{ type: 'Block', name: '!!!' },
	null
]) {
	tui.showCreation = async () => creation;
	await tui.commandHandler('n', {});
}
await tui.commandHandler('p', {});
await tui.commandHandler('p', {});
await tui.commandHandler('i', {});
await tui.commandHandler('', { return: true });
process.exit(0);
`);
	assert.equal(code, 0, output);
	const block = JSON.parse(await fs.readFile(path.join(root, 'blocks/my-block/src/block.json'), 'utf8'));
	assert.equal(block.name, 'custom/my-block');
	assert.equal(block.title, 'My Block');
	await fs.access(path.join(root, 'blocks/my-block/src/index.js'));
	const pattern = await fs.readFile(path.join(root, 'patterns/hero-section.php'), 'utf8');
	assert.match(pattern, /Title: Hero Section/);
	assert.match(pattern, /Slug: custom\/hero-section/);
	const variation = JSON.parse(await fs.readFile(path.join(root, 'styles/dark-mode.json'), 'utf8'));
	assert.equal(variation.title, 'Dark Mode');
	assert.equal(variation.slug, 'dark-mode');

	assert.match(output, /ADDBLOCK my-block/);
	assert.match(output, /Created block at blocks\/my-block/);
	assert.match(output, /blocks\/my-block already exists/);
	assert.match(output, /patterns\/hero-section\.php already exists/);
	assert.match(output, /styles\/dark-mode\.json already exists/);
	assert.match(output, /Enter a name containing letters or numbers/);
	assert.match(output, /Resumed build process/);
	assert.match(output, /Paused build process/);
	assert.match(output, /Build process paused\. Press \[p\] to resume/);
	assert.match(output, /SHOWINFO/);
});

test('unhandled rejections are logged and fail one-shot runs', async t => {
	const root = await plainProject(t);
	const { code, output } = await runScript(root, `
await init();
Promise.reject(new Error('boom'));
await new Promise(resolve => setTimeout(resolve, 50));
process.exit(process.exitCode ?? 0);
`);
	assert.equal(code, 1, output);
	assert.match(output, /Unhandled Promise Rejection: Error: boom/);
});

test('uncaught exceptions are logged and shut down with a nonzero status', async t => {
	const root = await plainProject(t);
	const { code, output } = await runScript(root, `
await init();
setTimeout(() => { throw new Error('kaboom'); }, 10);
await new Promise(resolve => setTimeout(resolve, 2000));
console.log('SHOULD NOT REACH');
`);
	assert.equal(code, 1, output);
	assert.match(output, /Uncaught Exception: kaboom/);
	assert.match(output, /Attempting graceful shutdown/);
	assert.doesNotMatch(output, /SHOULD NOT REACH/);
});

test('a failing agents install reports the error with a nonzero status', async t => {
	const root = await plainProject(t);
	await fs.mkdir(path.join(root, 'AGENTS.md')); // reading a directory fails with EISDIR rather than ENOENT
	const { code, output } = await run(root, ['agents', 'reference']);
	assert.equal(code, 1, output);
	assert.match(output, /Failed to install agents helpers/);
});
