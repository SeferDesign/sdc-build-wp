import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import project from '../lib/project.js';
import BlocksComponent from '../lib/components/blocks.js';

async function setup(t) {
	const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-block-watch-')));
	const originalPath = project.path;
	project.path = root;
	const component = new BlocksComponent();
	component.project = {
		...project, path: root, config: {}, entries: {}, components: {}, isRunning: true,
		chokidarOpts: { ignoreInitial: true, ignored: [path.join(root, 'node_modules')] }
	};
	component.log = () => {};
	t.mock.method(component, 'process', async () => {});
	t.after(async () => {
		await component.stopWatching();
		project.path = originalPath;
		await fs.rm(root, { recursive: true, force: true });
	});
	return { root, component };
}

async function start(component) {
	component.watch();
	await once(component.watcher, 'ready');
	await new Promise(resolve => setTimeout(resolve, 300));
}

// Resolves once the watcher has reported every listed event and finished handling them.
async function settle(component, events, action) {
	const pending = new Set(events.map(([type, file]) => `${type}:${file}`));
	const seen = new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`Missing events: ${[...pending]}`)), 10000);
		const handler = (type, file) => {
			pending.delete(`${type}:${file}`);
			if (pending.size === 0) {
				clearTimeout(timer);
				component.watcher.off('all', handler);
				resolve();
			}
		};
		component.watcher.on('all', handler);
	});
	await action();
	await seen;
	await new Promise(resolve => setTimeout(resolve, 50));
	await component.watchPending;
}

const fullScans = rebuild => rebuild.mock.calls.filter(call => call.arguments.length === 0 || !call.arguments[0]).length;

async function makeBlock(root, name, source) {
	const block = path.join(root, 'blocks', name);
	await fs.mkdir(path.join(block, 'src'), { recursive: true });
	await fs.writeFile(path.join(block, 'src/block.json'), JSON.stringify({ name: `fixture/${name}` }));
	await fs.writeFile(path.join(block, 'src/index.js'), source);
	return block;
}

test('unrelated asset changes never rescan the block dependency map', { timeout: 20000 }, async t => {
	const { root, component } = await setup(t);
	await component.init();
	const rebuild = t.mock.method(component, 'rebuildDependencyMap');
	await start(component);
	const image = path.join(root, '_src/images/photo.png');
	await fs.mkdir(path.dirname(image), { recursive: true });
	await settle(component, [['add', image]], () => fs.writeFile(image, 'one'));
	await settle(component, [['change', image]], () => fs.writeFile(image, 'two'));
	await settle(component, [['unlink', image]], () => fs.unlink(image));
	assert.equal(rebuild.mock.callCount(), 0);
});

test('a new source file rescans once, and edits to it do not rescan again', { timeout: 20000 }, async t => {
	const { root, component } = await setup(t);
	await component.init();
	const rebuild = t.mock.method(component, 'rebuildDependencyMap');
	await start(component);
	const script = path.join(root, '_src/scripts/helper.js');
	await fs.mkdir(path.dirname(script), { recursive: true });
	await settle(component, [['add', script]], () => fs.writeFile(script, 'export default 1;'));
	assert.equal(fullScans(rebuild), 1);
	await settle(component, [['change', script]], () => fs.writeFile(script, 'export default 2;'));
	assert.equal(fullScans(rebuild), 1);
});

test('a burst of new files is covered by one rescan', { timeout: 20000 }, async t => {
	const { root, component } = await setup(t);
	await component.init();
	const rebuild = t.mock.method(component, 'rebuildDependencyMap');
	await start(component);
	const directory = path.join(root, '_src/scripts');
	await fs.mkdir(directory, { recursive: true });
	const files = Array.from({ length: 8 }, (_, index) => path.join(directory, `file-${index}.js`));
	await settle(component, files.map(file => ['add', file]), () => Promise.all(files.map(file => fs.writeFile(file, 'export default 1;'))));
	assert.ok(fullScans(rebuild) >= 1 && fullScans(rebuild) <= 2, `rescans: ${fullScans(rebuild)}`);
});

test('a new file that satisfies a previously missing import rebuilds the block', { timeout: 20000 }, async t => {
	const { root, component } = await setup(t);
	const block = await makeBlock(root, 'needy', 'import helper from "../../../_src/scripts/missing.js";');
	await component.init();
	const built = [];
	component.process.mock.mockImplementation(async entry => { built.push(entry); });
	await start(component);
	const missing = path.join(root, '_src/scripts/missing.js');
	await fs.mkdir(path.dirname(missing), { recursive: true });
	await settle(component, [['add', missing]], () => fs.writeFile(missing, 'export default 1;'));
	await new Promise(resolve => setTimeout(resolve, 800)); // debounce
	assert.deepEqual(built, [block]);
	assert.deepEqual(component.getAffectedBlocks(missing), new Set([block]));
});

test('removing a shared file refreshes only the blocks that used it', { timeout: 20000 }, async t => {
	const { root, component } = await setup(t);
	const shared = path.join(root, '_src/scripts/shared.js');
	await fs.mkdir(path.dirname(shared), { recursive: true });
	await fs.writeFile(shared, 'export default 1;');
	const user = await makeBlock(root, 'user', 'import shared from "../../../_src/scripts/shared.js";');
	await makeBlock(root, 'bystander', 'export default 1;');
	await component.init();
	assert.deepEqual(component.getAffectedBlocks(shared), new Set([user]));
	const rebuild = t.mock.method(component, 'rebuildDependencyMap');
	await start(component);
	await settle(component, [['unlink', shared]], () => fs.unlink(shared));
	assert.equal(rebuild.mock.callCount(), 1);
	assert.deepEqual(rebuild.mock.calls[0].arguments[0], [user]);
});

test('removing a directory refreshes only blocks with dependencies inside it', { timeout: 20000 }, async t => {
	const { root, component } = await setup(t);
	const directory = path.join(root, '_src/shared');
	await fs.mkdir(directory, { recursive: true });
	await fs.writeFile(path.join(directory, 'util.js'), 'export default 1;');
	const user = await makeBlock(root, 'user', 'import util from "../../../_src/shared/util.js";');
	await makeBlock(root, 'bystander', 'export default 1;');
	await component.init();
	assert.deepEqual(component.getDependentsOfRemovedPath(directory, true), [user]);
	assert.deepEqual(component.getDependentsOfRemovedPath(path.join(root, '_src/other'), true), []);
	assert.deepEqual(component.getDependentsOfRemovedPath(path.join(directory, 'util.js'), false), [user]);
	assert.deepEqual(component.getDependentsOfRemovedPath(path.join(root, 'unknown.js'), false), []);
});

test('only source-like added files can resolve missing dependencies', async t => {
	const { root, component } = await setup(t);
	const file = path.join(root, 'new.js');
	await fs.writeFile(file, 'export default 1;');
	assert.equal(await component.mayResolveMissingDependency('add', file), true);
	assert.equal(await component.mayResolveMissingDependency('change', file), false);
	assert.equal(await component.mayResolveMissingDependency('add', path.join(root, 'photo.png')), false);
	assert.equal(await component.mayResolveMissingDependency('add', path.join(root, 'absent.js')), false);
	await component.rebuildDependencyMap();
	component.fullMapRescanStartedAt = Date.now() + 60000;
	assert.equal(await component.mayResolveMissingDependency('add', file), false, 'files older than the last rescan were already seen');
});
