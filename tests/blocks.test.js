import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import project from '../lib/project.js';
import BlocksComponent from '../lib/components/blocks.js';

async function setup(t) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-blocks-'));
	const originalPath = project.path;
	project.path = root;
	t.after(async () => {
		project.path = originalPath;
		await fs.rm(root, { recursive: true, force: true });
	});
	const component = new BlocksComponent();
	const logs = [];
	component.log = (type, message) => logs.push({ type, message });
	return { root, component, logs };
}

async function makeBlock(root, name) {
	const entry = path.join(root, 'blocks', name);
	await fs.mkdir(path.join(entry, 'src'), { recursive: true });
	await fs.writeFile(path.join(entry, 'src/block.json'), JSON.stringify({ name: `fixture/${name}` }));
	await fs.writeFile(path.join(entry, 'src/index.js'), 'export default 1;');
	return entry;
}

test('block dependency maps include shared JS and Sass dependencies and remove stale associations', async t => {
	const { root, component } = await setup(t);
	const first = await makeBlock(root, 'first');
	const second = await makeBlock(root, 'second');
	const shared = path.join(root, 'shared.js');
	const sass = path.join(root, '_shared.scss');
	await fs.writeFile(shared, 'export default 2;');
	await fs.writeFile(sass, '$color: #123456;');
	for (const block of [first, second]) {
		await fs.writeFile(path.join(block, 'src/index.js'), 'import shared from "../../../shared.js";');
		await fs.writeFile(path.join(block, 'src/style.scss'), '@use "../../../shared";');
	}
	component.globs = [first, second];
	await component.rebuildDependencyMap();
	assert.deepEqual(component.getAffectedBlocks(shared), new Set([first, second]));
	assert.deepEqual(component.getAffectedBlocks(sass), new Set([first, second]));
	assert.ok(component.dependencyMap.get(first).includes(path.join(first, 'src/block.json')));
	component.setBlockDependencies(first, []);
	assert.deepEqual(component.getAffectedBlocks(shared), new Set([second]));
	component.clearBlockDependencies(second);
	assert.deepEqual(component.getAffectedBlocks(shared), new Set());
	assert.equal(await component.getCurrentFileHash(path.join(root, 'absent')), null);
	assert.match(await component.getCurrentFileHash(shared), /^[a-f0-9]{64}$/);
});

test('cached blocks require existing output and missing block metadata fails explicitly', async t => {
	const { root, component, logs } = await setup(t);
	const entry = await makeBlock(root, 'cached');
	assert.equal(await component.buildOutputExists(path.join(entry, 'build')), false);
	await fs.mkdir(path.join(entry, 'build'));
	assert.equal(await component.buildOutputExists(path.join(entry, 'build')), false);
	await fs.writeFile(path.join(entry, 'build/index.js'), 'cached output');
	t.mock.method(component, 'shouldSkipBuild', async () => true);
	const end = t.mock.method(component, 'end', () => {});
	assert.equal(await component.build(entry), true);
	assert.equal(end.mock.calls[0].arguments[0].cached, true);
	await component.buildAll([entry]);
	assert.equal(end.mock.calls.length, 2);
	assert.equal(await component.build(path.join(root, 'absent')), false);
	await component.buildAll([path.join(root, 'absent')]);
	assert.equal(logs.filter(entry => /no block.json found/.test(entry.message)).length, 2);
});

test('block batch compilation caches only successful builds and reports compiler diagnostics', async t => {
	const { root, component, logs } = await setup(t);
	const good = await makeBlock(root, 'good');
	const bad = await makeBlock(root, 'bad');
	t.mock.method(component, 'shouldSkipBuild', async () => false);
	t.mock.method(component, 'resolveBlockWebpackConfig', entry => ({ name: entry }));
	t.mock.method(component, 'runWebpackConfigs', async ([config]) => ({
		stats: [{
			hasErrors: () => config.name === bad,
			toJson: () => ({ errors: [{ message: 'Invalid block source' }] })
		}]
	}));
	const update = t.mock.method(component, 'updateBuildCache', async () => {});
	await component.buildAll([good, bad]);
	assert.equal(update.mock.calls.length, 1);
	assert.equal(update.mock.calls[0].arguments[0], path.join(good, 'src/block.json'));
	assert.ok(logs.some(entry => /Invalid block source/.test(entry.message)));
	assert.ok(logs.some(entry => entry.type === 'error' && entry.message.includes('/bad')));
	assert.ok(logs.some(entry => /Built 1\/2 blocks/.test(entry.message)));
});

test('block config resolution and compiler failures never populate the cache', async t => {
	const { root, component, logs } = await setup(t);
	const entry = await makeBlock(root, 'broken');
	t.mock.method(component, 'shouldSkipBuild', async () => false);
	t.mock.method(component, 'resolveBlockWebpackConfig', () => { throw new Error('bad config'); });
	const update = t.mock.method(component, 'updateBuildCache', async () => {});
	await component.buildAll([entry]);
	assert.ok(logs.some(log => /Failed to resolve webpack config/.test(log.message)));
	t.mock.method(component, 'resolveBlockWebpackConfig', () => ({}));
	t.mock.method(component, 'runWebpackConfigs', async () => { throw new Error('compiler failed'); });
	await component.buildAll([entry]);
	assert.ok(logs.some(log => /Failed building blocks/.test(log.message)));
	assert.equal(update.mock.calls.length, 0);
	await component.buildAll([]);
});

test('block build queue bounds concurrency and drains after a rejected build', async t => {
	const { component } = await setup(t);
	component.utils = { ...component.utils, getComponentConcurrency: () => 2 };
	let active = 0;
	let maximum = 0;
	t.mock.method(component, 'build', async entry => {
		active++;
		maximum = Math.max(maximum, active);
		await new Promise(resolve => setTimeout(resolve, 5));
		active--;
		if (entry === 'bad') { throw new Error('build rejected'); }
		return entry;
	});
	const results = await Promise.allSettled(['first', 'bad', 'last'].map(entry => component.queueBuild(entry)));
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(maximum, 2);
	assert.equal(results[0].value, 'first');
	assert.match(results[1].reason.message, /build rejected/);
	assert.equal(results[2].value, 'last');
	assert.equal(component.activeBuilds, 0);
	assert.equal(component.pendingBuilds.length, 0);
	assert.equal(component.isFlushingQueue, false);
});
