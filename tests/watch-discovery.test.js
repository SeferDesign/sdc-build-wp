import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import project from '../lib/project.js';
import BaseComponent from '../lib/components/base.js';
import HTMLComponent from '../lib/components/html.js';
import ScriptsComponent from '../lib/components/scripts.js';
import StyleComponent from '../lib/components/style.js';
import FontsComponent from '../lib/components/fonts.js';
import BlocksComponent from '../lib/components/blocks.js';
import CacheComponent from '../lib/components/cache.js';

async function setup(t, Component, config = {}) {
	const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-watch-')));
	const originalPath = project.path;
	project.path = root;
	const component = new Component();
	component.project = {
		...project, path: root, config, entries: {}, components: {}, isRunning: true,
		sdcDir: path.join(root, '.sdc-build-wp'),
		paths: { ...project.paths, theme: { json: path.join(root, 'theme.json') } },
		chokidarOpts: {
			ignoreInitial: true,
			ignored: [path.join(root, 'node_modules'), path.join(root, 'vendor'), path.join(root, '.git')]
		}
	};
	const logs = [];
	component.log = (type, message) => logs.push({ type, message });
	t.after(async () => {
		await component.stopWatching();
		project.path = originalPath;
		await fs.rm(root, { recursive: true, force: true });
	});
	return { root, component, logs };
}

async function start(component) {
	component.watch();
	await once(component.watcher, 'ready');
	// Allow the OS watcher backend to become active after Chokidar's initial scan.
	await new Promise(resolve => setTimeout(resolve, 300));
}

async function mutate(component, event, file, action) {
	let timer;
	const seen = new Promise((resolve, reject) => {
		const handler = (type, entry) => {
			if (type === event && entry === file) {
				component.watcher.off('all', handler);
				resolve();
			}
		};
		component.watcher.on('all', handler);
		timer = setTimeout(() => {
			component.watcher.off('all', handler);
			reject(new Error(`Watcher did not emit ${event} for ${file}`));
		}, 2500);
	});
	try {
		await action();
		await seen;
		await component.watchPending;
	} finally {
		clearTimeout(timer);
	}
}

test('shared watcher expands directory braces, filters files and serializes events', async t => {
	const { root, component, logs } = await setup(t, BaseComponent);
	await Promise.all(['scripts', 'styles'].map(directory => fs.mkdir(path.join(root, directory))));
	const handlers = new Map();
	const watcher = { on: (event, handler) => { handlers.set(event, handler); return watcher; } };
	let roots;
	component.chokidar = { watch: paths => { roots = paths; return watcher; } };
	component.setGlobPatterns(`${root}/{scripts,styles}/**/*.{js,scss}`);
	let release;
	const gate = new Promise(resolve => { release = resolve; });
	const calls = [];
	component.watchGlobs(async (event, file) => {
		calls.push(file);
		if (calls.length === 1) { await gate; }
		if (file.endsWith('bad.js')) { throw new Error('processing failed'); }
	});
	assert.deepEqual(roots, [path.join(root, 'scripts'), path.join(root, 'styles')]);
	const callback = handlers.get('all');
	callback('addDir', path.join(root, 'scripts'));
	callback('add', path.join(root, 'scripts/notes.txt'));
	const first = callback('add', path.join(root, 'scripts/first.js'));
	const second = callback('add', path.join(root, 'scripts/bad.js'));
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(calls.length, 1);
	release();
	await Promise.all([first, second]);
	await callback('change', path.join(root, 'scripts/last.js'));
	assert.equal(calls.length, 3);
	assert.ok(logs.some(log => log.type === 'error' && /processing failed/.test(log.message)));
	handlers.get('error')(new Error('watch failed'));
	assert.ok(logs.some(log => /watch failed/.test(log.message)));
	component.watcher = null;
});

test('HTML watcher formats additions, tracks deletion and respects custom glob arrays', { timeout: 10000 }, async t => {
	const { root, component } = await setup(t, HTMLComponent);
	component.project.config.htmlGlobPath = [`${root}/pages/**/*.html`, `${root}/other/*.html`];
	await component.init();
	await start(component);
	const file = path.join(root, 'pages/new/index.html');
	await mutate(component, 'addDir', path.dirname(file), () => fs.mkdir(path.dirname(file), { recursive: true }));
	await mutate(component, 'add', file, () => fs.writeFile(file, '<div><span>Hello</span></div>'));
	assert.ok(component.globs.includes(file));
	assert.equal(await fs.readFile(file, 'utf8'), '<div><span>Hello</span></div>\n');
	const outside = path.join(root, 'outside.html');
	await fs.writeFile(outside, '<div>untouched</div>');
	assert.ok(!component.matchesGlob(outside));
	await mutate(component, 'unlink', file, () => fs.unlink(file));
	assert.ok(!component.globs.includes(file));
});

for (const Component of [ScriptsComponent, StyleComponent]) {
	for (const configured of [false, true]) {
		test(`${Component.name} discovers entries and dependencies ${configured ? 'with explicit entries' : 'automatically'}`, { timeout: 10000 }, async t => {
			const { root, component, logs } = await setup(t, Component);
			const scripts = Component === ScriptsComponent;
			const type = scripts ? 'scripts' : 'style';
			const extension = scripts ? '.js' : '.scss';
			const source = path.join(root, '_src', type);
			const entry = path.join(source, `main${extension}`);
			const dependency = path.join(source, 'partials', `dependency${extension}`);
			if (configured) {
				component.project.config.entries = { [`${type}/custom`]: [`/_src/${type}/main${extension}`] };
				component.project.entries = component.project.config.entries;
			}
			const builds = [];
			const lint = t.mock.method(component, 'lint', async () => true);
			t.mock.method(component, 'build', async file => { builds.push(file); return true; });
			if (!scripts) { t.mock.method(component, 'buildTheme', async () => {}); }
			await component.init();
			await start(component);
			await fs.mkdir(path.dirname(dependency), { recursive: true });
			const entryContent = scripts ? 'import value from "./partials/dependency.js";' : '@use "partials/dependency";';
			await mutate(component, 'add', entry, () => fs.writeFile(entry, entryContent));
			assert.ok(component.files.some(group => group.file === entry && group.name === `${type}/${configured ? 'custom' : 'main'}`));
			assert.ok(builds.includes(entry));
			const before = builds.length;
			await mutate(component, 'add', dependency, () => fs.writeFile(dependency, scripts ? 'export default 1;' : '$color: red;'));
			assert.ok(builds.length > before);
			assert.deepEqual(component.getAffectedEntries(dependency), [entry]);
			assert.ok(component.globs.includes(dependency));
			assert.ok(!component.files.some(group => group.file === dependency));
			assert.ok(lint.mock.calls.some(call => call.arguments[0].includes(dependency)));
			const other = path.join(source, `other${extension}`);
			await mutate(component, 'add', other, () => fs.writeFile(other, scripts ? 'export default 2;' : '.other { color: red; }'));
			assert.equal(component.files.some(group => group.file === other), !configured);
			await mutate(component, 'unlink', dependency, () => fs.unlink(dependency));
			assert.ok(!component.globs.includes(dependency));
			await mutate(component, 'unlink', entry, () => fs.unlink(entry));
			assert.ok(!component.files.some(group => group.file === entry));
			await mutate(component, 'add', entry, () => fs.writeFile(entry, scripts ? 'export default 3;' : '.main { color: blue; }'));
			assert.ok(component.files.some(group => group.file === entry));
			await component.stopWatching();
			await component.init();
			assert.ok(component.files.some(group => group.file === entry));
			assert.ok(!logs.some(log => log.type === 'error'), JSON.stringify(logs));
		});
	}
}

test('font watcher copies files from an initially missing custom source directory', { timeout: 10000 }, async t => {
	const { root, component } = await setup(t, FontsComponent);
	const source = path.join(root, 'custom-fonts');
	component.project.config.fontsPath = source;
	await component.init();
	await start(component);
	await fs.mkdir(source);
	const file = path.join(source, 'new.woff2');
	await mutate(component, 'add', file, () => fs.writeFile(file, 'font data'));
	assert.equal(await fs.readFile(path.join(root, 'dist/fonts/new.woff2'), 'utf8'), 'font data');
});

test('block watcher discovers manual blocks, rebuilds shared dependencies and forgets removed blocks', { timeout: 10000 }, async t => {
	const { root, component, logs } = await setup(t, BlocksComponent);
	const builds = [];
	let notify;
	t.mock.method(component, 'process', async block => {
		builds.push(block);
		notify?.();
	});
	await component.init();
	await start(component);
	const block = path.join(root, 'blocks/new');
	const metadata = path.join(block, 'src/block.json');
	const script = path.join(block, 'src/index.js');
	const shared = path.join(root, '_src/scripts/shared.js');
	await fs.mkdir(path.dirname(script), { recursive: true });
	await fs.mkdir(path.dirname(shared), { recursive: true });
	await mutate(component, 'add', shared, () => fs.writeFile(shared, 'export default 1;'));
	await mutate(component, 'add', script, () => fs.writeFile(script, 'import shared from "../../../_src/scripts/shared.js";'));
	assert.ok(!component.globs.includes(block));
	let built = new Promise(resolve => { notify = resolve; });
	await mutate(component, 'add', metadata, () => fs.writeFile(metadata, '{"name":"test/new"}'));
	await built;
	assert.ok(component.globs.includes(block));
	await component.rebuildDependencyMap([block]);
	assert.deepEqual(component.getAffectedBlocks(shared), new Set([block]));
	built = new Promise(resolve => { notify = resolve; });
	await mutate(component, 'change', shared, () => fs.writeFile(shared, 'export default 2;'));
	await built;
	assert.equal(builds.filter(entry => entry === block).length, 2);
	await mutate(component, 'unlink', metadata, () => fs.unlink(metadata));
	assert.ok(!component.globs.includes(block));
	assert.deepEqual(component.getAffectedBlocks(shared), new Set());
	assert.ok(!logs.some(log => log.type === 'error'), JSON.stringify(logs));
});

test('cache watcher invalidates additions, changes and deletions but excludes internal directories', { timeout: 10000 }, async t => {
	const { root, component } = await setup(t, CacheComponent);
	const invalidated = [];
	t.mock.method(component, 'invalidateFile', async file => { invalidated.push(file); });
	await start(component);
	const entry = path.join(root, 'new.js');
	await mutate(component, 'add', entry, () => fs.writeFile(entry, 'one'));
	await mutate(component, 'change', entry, () => fs.writeFile(entry, 'two'));
	await mutate(component, 'unlink', entry, () => fs.unlink(entry));
	assert.ok(invalidated.length >= 3);
	assert.ok(invalidated.every(file => file === entry));
	for (const directory of ['.sdc-build-wp', '.git', 'vendor', 'node_modules']) {
		await fs.mkdir(path.join(root, directory));
		await fs.writeFile(path.join(root, directory, 'ignored.js'), 'ignored');
	}
	const barrier = path.join(root, 'barrier.js');
	await mutate(component, 'add', barrier, () => fs.writeFile(barrier, 'barrier'));
	await new Promise(resolve => setTimeout(resolve, 100));
	assert.deepEqual(new Set(invalidated), new Set([entry, barrier]));
});
