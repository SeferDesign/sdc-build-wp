import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import project from '../lib/project.js';
import * as utils from '../lib/utils.js';

test('JS dependency discovery resolves extensions, directory imports, root imports and cycles', async t => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-deps-'));
	const originalPath = project.path;
	project.path = root;
	t.after(async () => { project.path = originalPath; await fs.rm(root, { recursive: true, force: true }); });
	await fs.mkdir(path.join(root, 'directory'));
	await Promise.all([
		fs.writeFile(path.join(root, 'entry.js'), [
			'import value from "./typed";',
			'import other from "./directory";',
			'import root from "/root.mjs";',
			'import external from "external-package";',
			'import missing from "./missing.js";',
			'import("./dynamic.tsx");',
			'require("./typed");'
		].join('\n')),
		fs.writeFile(path.join(root, 'typed.ts'), 'import cycle from "./entry.js";'),
		fs.writeFile(path.join(root, 'directory/index.jsx'), 'export default 1;'),
		fs.writeFile(path.join(root, 'root.mjs'), 'export default 2;'),
		fs.writeFile(path.join(root, 'dynamic.tsx'), 'export default 3;')
	]);
	const direct = await utils.getImportedJSFiles(path.join(root, 'entry.js'));
	assert.deepEqual(direct.map(file => path.relative(root, file)).sort(), ['directory/index.jsx', 'dynamic.tsx', 'root.mjs', 'typed.ts']);
	const all = await utils.getAllJSDependencies(path.join(root, 'entry.js'));
	assert.equal(new Set(all).size, all.length);
	assert.ok(all.includes(path.join(root, 'entry.js')));
	assert.deepEqual(await utils.getImportedJSFiles(path.join(root, 'absent.js')), []);
});

test('file discovery, directory creation and entry selection respect file types', async t => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-utils-'));
	const originalPath = project.path;
	const originalEntries = project.entries;
	project.path = root;
	project.entries = { 'scripts/main': ['/main.js'], 'style/main': ['/main.scss'] };
	t.after(async () => {
		project.path = originalPath;
		project.entries = originalEntries;
		await fs.rm(root, { recursive: true, force: true });
	});
	assert.equal(await utils.ensureDir(path.join(root, 'nested/deeper')), true);
	await fs.writeFile(path.join(root, 'main.js'), '');
	await fs.writeFile(path.join(root, 'main.scss'), '@use "nested/tokens";\n@import "other";');
	assert.deepEqual(await utils.getAllFiles(root, '.js'), [path.join(root, 'main.js')]);
	assert.equal((await utils.getAllFiles(root)).length, 2);
	assert.deepEqual(await utils.getAllFiles(path.join(root, 'missing')), []);
	assert.deepEqual(await utils.getAllSubdirectories(root), [path.join(root, 'nested'), path.join(root, 'nested/deeper')]);
	assert.deepEqual(utils.addEntriesByFiletypes(['.js']), [{ name: 'scripts/main', file: path.join(root, 'main.js') }]);
	assert.deepEqual(await utils.getImportedSASSFiles(path.join(root, 'main.scss')), [
		path.join(root, 'nested/tokens.scss'), path.join(root, 'nested/_tokens.scss'), path.join(root, 'other.scss')
	]);
	assert.equal(utils.camelToDash('fontSizeBase'), 'font-size-base');
	assert.equal(utils.slugify('  My   Block!  '), 'my-block');
});

test('concurrency configuration falls back for invalid limits and preserves iterator ordering', async t => {
	const config = project.config;
	t.after(() => { project.config = config; });
	project.config = { buildConcurrency: { default: 3, scripts: 2.9, images: 0, blocks: Infinity } };
	assert.equal(utils.getComponentConcurrency('scripts'), 2);
	assert.equal(utils.getComponentConcurrency('images'), 3);
	assert.equal(utils.getComponentConcurrency('blocks', 5), 5);
	assert.deepEqual(await utils.runWithConcurrency([], 2, () => assert.fail()), []);
	assert.deepEqual(await utils.runWithConcurrency([4, 3, 2], NaN, async (value, index) => value + index), [4, 4, 4]);
	await assert.rejects(utils.runWithConcurrency([1], 1, () => { throw new Error('iterator failed'); }), /iterator failed/);
});
