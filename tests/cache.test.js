import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../lib/project.js';
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
