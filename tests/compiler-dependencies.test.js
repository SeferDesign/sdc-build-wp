import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import project from '../lib/project.js';
import CacheComponent from '../lib/components/cache.js';
import { makeTheme, run } from './helpers/index.js';

const readManifest = async root => JSON.parse(await fs.readFile(path.join(root, '.sdc-build-wp/cache/manifest.json'), 'utf8'));

test('Sass files loaded dynamically via meta.load-css invalidate the cache', async t => {
	const root = await makeTheme(t);
	const partials = path.join(await fs.realpath(root), '_src/style/partials'); // the CLI sees the canonical cwd
	await fs.writeFile(path.join(partials, '_dynamic.scss'), '.dynamic { color: #111111; }\n');
	await fs.writeFile(path.join(root, '_src/style/main.scss'), '@use "sass:meta";\n@include meta.load-css("partials/dynamic");\n');
	assert.equal((await run(root, ['--builds=style'])).code, 0);

	const entry = Object.values((await readManifest(root)).entries).find(item => item.inputFile.endsWith('main.scss'));
	assert.ok(Object.hasOwn(entry.discoveredDependencies, path.join(partials, '_dynamic.scss')), 'compiler-reported file is recorded');
	assert.match((await run(root, ['--builds=style'])).output, /main\.min\.css \(cached\)/);

	await fs.writeFile(path.join(partials, '_dynamic.scss'), '.dynamic { color: #222222; }\n');
	const { output } = await run(root, ['--builds=style']);
	assert.doesNotMatch(output, /\(cached\)/);
	assert.match(await fs.readFile(path.join(root, 'dist/style/main.min.css'), 'utf8'), /#222/);
});

test('bundled package files invalidate the script cache even though imports are bare specifiers', async t => {
	const root = await makeTheme(t);
	const packageDir = path.join(root, 'node_modules/local-package');
	await fs.mkdir(packageDir, { recursive: true });
	await fs.writeFile(path.join(packageDir, 'package.json'), '{"name":"local-package","main":"index.js"}');
	await fs.writeFile(path.join(packageDir, 'index.js'), 'export const value = "first";\n');
	await fs.writeFile(path.join(root, '_src/scripts/main.js'), 'import { value } from "local-package";\nexport const getMessage = () => value;\n');
	assert.equal((await run(root, ['--builds=scripts'])).code, 0);
	assert.match(await fs.readFile(path.join(root, 'dist/scripts/main.min.js'), 'utf8'), /first/);
	assert.match((await run(root, ['--builds=scripts'])).output, /main\.min\.js \(cached\)/);

	await fs.writeFile(path.join(packageDir, 'index.js'), 'export const value = "second";\n');
	const { output } = await run(root, ['--builds=scripts']);
	assert.doesNotMatch(output, /\(cached\)/);
	assert.match(await fs.readFile(path.join(root, 'dist/scripts/main.min.js'), 'utf8'), /second/);
});

async function createCache(t) {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-discovered-'));
	const originalPath = project.path;
	project.path = directory;
	const cache = new CacheComponent();
	cache.cacheDir = directory;
	cache.manifestPath = path.join(directory, 'manifest.json');
	cache.manifest = cache.createManifest('test');
	t.after(async () => {
		await cache.flushManifest();
		project.path = originalPath;
		await fs.rm(directory, { recursive: true, force: true });
	});
	return { directory, cache };
}

test('discovered dependencies are hashed, checked and invalidated separately from predicted ones', async t => {
	const { directory, cache } = await createCache(t);
	const [input, output, predicted, discovered] = ['input.js', 'output.js', 'predicted.js', 'discovered.js'].map(name => path.join(directory, name));
	await Promise.all([input, output, predicted, discovered].map(file => fs.writeFile(file, path.basename(file))));
	await cache.updateCache(input, output, [predicted], [discovered, predicted, input]);

	const entry = cache.manifest.entries[cache.getCacheKey(input, output)];
	assert.deepEqual(Object.keys(entry.dependencies), [predicted]);
	assert.deepEqual(Object.keys(entry.discoveredDependencies), [discovered], 'duplicates and the input itself are not tracked twice');
	assert.equal(await cache.needsRebuild(input, output, [predicted]), false);

	await fs.writeFile(discovered, 'changed');
	cache.clearHashCache(discovered);
	assert.equal(await cache.needsRebuild(input, output, [predicted]), true);

	await cache.invalidateFile(discovered);
	assert.equal(cache.manifest.entries[cache.getCacheKey(input, output)], undefined);
});

test('cached entries without discovered dependencies still validate', async t => {
	const { directory, cache } = await createCache(t);
	const [input, output] = ['input.js', 'output.js'].map(name => path.join(directory, name));
	await Promise.all([fs.writeFile(input, 'a'), fs.writeFile(output, 'b')]);
	await cache.updateCache(input, output);
	delete cache.manifest.entries[cache.getCacheKey(input, output)].discoveredDependencies;
	assert.equal(await cache.needsRebuild(input, output), false);
	assert.deepEqual(cache.getCacheInfo(input, output).entry.dependencies, {});
});
