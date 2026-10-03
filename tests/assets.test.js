import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import project from '../lib/project.js';
import ImagesComponent from '../lib/components/images.js';
import FontsComponent from '../lib/components/fonts.js';
import HTMLComponent from '../lib/components/html.js';

async function setup(t, Component) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-assets-'));
	const original = { path: project.path, paths: project.paths, components: project.components };
	project.path = root;
	project.paths = { ...project.paths, dist: 'dist', images: path.join(root, '_src/images') };
	project.components = {};
	t.after(async () => {
		Object.assign(project, original);
		await fs.rm(root, { recursive: true, force: true });
	});
	const component = new Component();
	const logs = [];
	component.log = (type, message) => logs.push({ type, message });
	return { root, component, logs };
}

test('images process raster files, copy other assets, skip metadata and remove outputs', async t => {
	const { root, component } = await setup(t, ImagesComponent);
	const source = project.paths.images;
	await fs.mkdir(source, { recursive: true });
	const raster = path.join(source, 'pixel.png');
	await sharp({ create: { width: 2, height: 3, channels: 3, background: '#123456' } }).png().toFile(raster);
	assert.deepEqual(await component.buildFile(raster), { convertedImagesCount: 1, copiedFilesCount: 0 });
	const metadata = await sharp(path.join(root, 'dist/images/pixel.png')).metadata();
	assert.equal(metadata.width, 2);
	assert.equal(metadata.height, 3);
	const asset = path.join(source, 'data.txt');
	await fs.writeFile(asset, 'original bytes');
	assert.deepEqual(await component.processFile(asset), { convertedImagesCount: 0, copiedFilesCount: 1 });
	assert.equal(await fs.readFile(path.join(root, 'dist/images/data.txt'), 'utf8'), 'original bytes');
	assert.deepEqual(await component.processFile(path.join(source, '.DS_Store')), { convertedImagesCount: 0, copiedFilesCount: 0 });
	assert.deepEqual(await component.processFile(path.join(source, 'directory')), { convertedImagesCount: 0, copiedFilesCount: 0 });
	await component.remove(asset);
	await assert.rejects(fs.access(path.join(root, 'dist/images/data.txt')), { code: 'ENOENT' });
});

test('image directory processing reports corrupt files while preserving valid output', async t => {
	const { component, logs } = await setup(t, ImagesComponent);
	const directory = path.join(project.paths.images, 'nested');
	await fs.mkdir(directory, { recursive: true });
	await fs.writeFile(path.join(directory, 'bad.png'), 'not an image');
	await fs.writeFile(path.join(directory, 'data.txt'), 'valid asset');
	await component.process(directory);
	assert.ok(logs.some(entry => entry.type === 'error' && /Failed optimizing/.test(entry.message)));
	assert.equal(await fs.readFile(component.getOutputPath(path.join(directory, 'data.txt')), 'utf8'), 'valid asset');
});

test('font copying preserves bytes and nested directories and reports missing or empty input', async t => {
	const { root, component, logs } = await setup(t, FontsComponent);
	const source = path.join(root, '_src/fonts');
	await fs.mkdir(path.join(source, 'nested'), { recursive: true });
	await fs.writeFile(path.join(source, 'nested/font.woff2'), Buffer.from([0, 1, 2, 255]));
	await component.init();
	assert.deepEqual(await fs.readFile(path.join(root, 'dist/fonts/nested/font.woff2')), Buffer.from([0, 1, 2, 255]));
	assert.equal(await component.build(path.join(root, 'missing')), false);
	const empty = path.join(root, 'empty');
	await fs.mkdir(empty);
	assert.equal(await component.build(empty), false);
	assert.equal(logs.filter(entry => entry.type === 'error').length, 2);
});

test('HTML check mode does not modify files, write mode formats, and missing files fail explicitly', async t => {
	const { root, component, logs } = await setup(t, HTMLComponent);
	const entry = path.join(root, 'template.html');
	const original = '<div><p>fixture</p></div>';
	await fs.writeFile(entry, original);
	await component.init();
	assert.ok(component.globs.includes(entry));
	assert.equal(await component.build(entry, { formatType: 'check' }), false);
	assert.equal(await fs.readFile(entry, 'utf8'), original);
	await component.process(entry);
	const formatted = await fs.readFile(entry, 'utf8');
	assert.notEqual(formatted, original);
	assert.notEqual(await component.build(null, { formatType: 'check' }), false);
	assert.equal(await component.build(path.join(root, 'absent.html')), false);
	assert.ok(logs.some(entry => entry.type === 'warn' && /need.*formatting/.test(entry.message)));
	assert.ok(logs.some(entry => entry.type === 'error' && /Failed formatting/.test(entry.message)));
});
