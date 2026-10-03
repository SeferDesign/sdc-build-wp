import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import project from '../lib/project.js';
import CacheComponent from '../lib/components/cache.js';

async function createCache(t) {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-cache-test-'));
	const cache = new CacheComponent();
	cache.cacheDir = directory;
	cache.manifestPath = path.join(directory, 'manifest.json');
	cache.manifest = { entries: {}, version: 'test' };
	t.after(async () => {
		await cache.flushManifest();
		await fs.rm(directory, { recursive: true, force: true });
	});
	return cache;
}

test('cache batches updates into one atomic manifest write', async t => {
	const cache = await createCache(t);
	const write = t.mock.method(fs, 'writeFile');
	cache.beginBatch();
	for (let index = 0; index < 20; index++) {
		cache.manifest.entries[index] = { value: index };
		await cache.saveManifest();
	}
	assert.equal(write.mock.callCount(), 0);
	await cache.endBatch();
	assert.equal(write.mock.callCount(), 1);
	const saved = JSON.parse(await fs.readFile(cache.manifestPath, 'utf8'));
	assert.equal(Object.keys(saved.entries).length, 20);
	assert.deepEqual(await fs.readdir(cache.cacheDir), ['manifest.json']);
});

test('beginning a batch defers an already scheduled watch flush', async t => {
	const cache = await createCache(t);
	const write = t.mock.method(fs, 'writeFile');
	await cache.saveManifest();
	cache.beginBatch();
	await new Promise(resolve => setTimeout(resolve, 150));
	assert.equal(write.mock.callCount(), 0);
	await cache.endBatch();
	assert.equal(write.mock.callCount(), 1);
});

test('cache preserves updates made while a flush is in flight', async t => {
	const cache = await createCache(t);
	const originalWrite = fs.writeFile;
	let release;
	const gate = new Promise(resolve => { release = resolve; });
	t.mock.method(fs, 'writeFile', async (...args) => {
		await gate;
		return originalWrite(...args);
	});
	cache.manifest.entries.first = 1;
	await cache.saveManifest();
	const firstFlush = cache.flushManifest();
	cache.manifest.entries.second = 2;
	await cache.saveManifest();
	const secondFlush = cache.flushManifest();
	release();
	await Promise.all([firstFlush, secondFlush]);
	const saved = JSON.parse(await fs.readFile(cache.manifestPath, 'utf8'));
	assert.deepEqual(saved.entries, { first: 1, second: 2 });
});

test('cache coalesces watch updates and retains dirty state on write failure', async t => {
	const cache = await createCache(t);
	const write = t.mock.method(fs, 'writeFile');
	await Promise.all(Array.from({ length: 20 }, () => cache.saveManifest()));
	await new Promise(resolve => setTimeout(resolve, 150));
	await cache.flushManifest();
	assert.equal(write.mock.callCount(), 1);
	write.mock.restore();
	const failingWrite = t.mock.method(fs, 'writeFile', async () => {
		throw new Error('write failure');
	});
	await cache.saveManifest();
	await assert.rejects(cache.flushManifest(), /write failure/);
	assert.equal(cache.manifestDirty, true);
	failingWrite.mock.restore();
	await cache.flushManifest();
	assert.equal(cache.manifestDirty, false);
});

test('dependency hashing is parallel, bounded, and deduplicated', async t => {
	const cache = await createCache(t);
	const originalConfig = project.config;
	project.config = { buildConcurrency: { cache: 3 } };
	t.after(() => { project.config = originalConfig; });
	let active = 0;
	let maximum = 0;
	let reads = 0;
	t.mock.method(cache, 'readFileHash', async file => {
		active++;
		reads++;
		maximum = Math.max(maximum, active);
		await new Promise(resolve => setTimeout(resolve, 5));
		active--;
		return `hash:${file}`;
	});
	const files = Array.from({ length: 10 }, (_, index) => `file-${index}`);
	const hashes = await cache.getFileHashes([...files, ...files]);
	assert.equal(maximum, 3);
	assert.equal(reads, 10);
	assert.equal(Object.keys(hashes).length, 10);
	await Promise.all([cache.getFileHash('shared'), cache.getFileHash('shared')]);
	assert.equal(reads, 11);
});

test('invalidating a pending hash prevents stale reads from repopulating the cache', async t => {
	const cache = await createCache(t);
	let release;
	const gate = new Promise(resolve => { release = resolve; });
	let reads = 0;
	t.mock.method(cache, 'readFileHash', async () => {
		reads++;
		if (reads === 1) {
			await gate;
			return 'old';
		}
		return 'new';
	});
	const pending = cache.getFileHash('entry');
	cache.clearHashCache('entry');
	assert.equal(await cache.getFileHash('entry'), 'new');
	release();
	assert.equal(await pending, 'old');
	assert.equal(await cache.getFileHash('entry'), 'new');
	assert.equal(reads, 2);
});

test('parallel cache checks detect changed, added, removed, and missing dependencies', async t => {
	const cache = await createCache(t);
	const input = path.join(cache.cacheDir, 'input.js');
	const output = path.join(cache.cacheDir, 'output.js');
	const dependency = path.join(cache.cacheDir, 'dependency.js');
	await Promise.all([
		fs.writeFile(input, 'input'),
		fs.writeFile(output, 'output'),
		fs.writeFile(dependency, 'original')
	]);
	await cache.updateCache(input, output, [dependency, dependency]);
	assert.equal(await cache.needsRebuild(input, output, [dependency]), false);
	assert.equal(await cache.needsRebuild(input, output, []), true);
	assert.equal(await cache.needsRebuild(input, output, [dependency, input]), true);
	await fs.writeFile(dependency, 'changed');
	cache.clearHashCache(dependency);
	assert.equal(await cache.needsRebuild(input, output, [dependency]), true);
	await cache.updateCache(input, output, [dependency]);
	await fs.rm(dependency);
	await cache.invalidateFile(dependency);
	assert.equal(await cache.needsRebuild(input, output, [dependency]), true);
});

test('unexpected file read errors propagate instead of becoming cache hits', async t => {
	const cache = await createCache(t);
	t.mock.method(fs, 'readFile', async () => {
		const error = new Error('permission denied');
		error.code = 'EACCES';
		throw error;
	});
	await assert.rejects(cache.getFileHash('unreadable'), /permission denied/);
	assert.equal(cache.hashRequests.size, 0);
	assert.equal(cache.hashCache.size, 0);
});

test('missing files are rechecked if they appear without an invalidation event', async t => {
	const cache = await createCache(t);
	const file = path.join(cache.cacheDir, 'new.js');
	assert.equal(await cache.getFileHash(file), null);
	assert.equal(cache.hashCache.has(file), false);
	await fs.writeFile(file, 'new content');
	assert.notEqual(await cache.getFileHash(file), null);
});
