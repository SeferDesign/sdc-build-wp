import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withProject } from './helpers/index.js';
import BlocksComponent from '../lib/components/blocks.js';
import { validateConfig } from '../lib/config-validator.js';

async function setup(t, config = {}) {
	const root = await withProject(t, { config });
	const component = new BlocksComponent();
	const logs = [];
	component.log = (type, message) => logs.push({ type, message });
	return { root, component, logs };
}

// WordPress Scripts remembers the working directory it first loaded under, so every test that
// really compiles shares one project root (and cwd), as a real run does.
const originalCwd = process.cwd();
let compileRoot = null;
after(async () => {
	process.chdir(originalCwd);
	if (compileRoot) { await fs.rm(compileRoot, { recursive: true, force: true }); }
});

async function setupCompile(t) {
	const context = await setup(t);
	if (!compileRoot) {
		compileRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-block-compile-')));
		await fs.writeFile(path.join(compileRoot, 'package.json'), '{"name":"example"}');
		process.chdir(compileRoot);
	}
	context.component.project.path = compileRoot; // restored by withProject
	return { ...context, root: compileRoot };
}

async function makeBlock(root, name, source = 'export default 1;') {
	const entry = path.join(root, 'blocks', name);
	await fs.mkdir(path.join(entry, 'src'), { recursive: true });
	await fs.writeFile(path.join(entry, 'src/block.json'), JSON.stringify({ name: `fixture/${name}`, title: name }));
	await fs.writeFile(path.join(entry, 'src/index.js'), source);
	return entry;
}

test('block timeout is configurable per block with a 60 second default', async t => {
	const { component } = await setup(t);
	assert.equal(component.getBuildTimeoutMS(), 60000);
	component.project.config = { blocks: { timeout: 5 } };
	assert.equal(component.getBuildTimeoutMS(), 5000);
	component.project.config = { blocks: { timeout: 'soon' } };
	assert.equal(component.getBuildTimeoutMS(), 60000);
	assert.equal(validateConfig({ blocks: { timeout: 30 } }), true);
	for (const blocks of [{ timeout: 0 }, { timeout: 1.5 }, { timeout: '30' }, { retries: 1 }]) {
		assert.equal(validateConfig({ blocks }), false, JSON.stringify(blocks));
	}
});

test('a compile that exceeds the timeout rejects instead of hanging', async t => {
	const { root, component } = await setupCompile(t);
	const block = await makeBlock(root, 'slow');
	const config = component.resolveBlockWebpackConfig(block, path.join(block, 'build'));
	await assert.rejects(component.runWebpackConfigs([config], 1), /Build timeout after 0\.001 seconds/);
});

test('single block builds share the batch pipeline: compile once, then cache', async t => {
	const { root, component, logs } = await setupCompile(t);
	const block = await makeBlock(root, 'shared-path');
	const compile = t.mock.method(component, 'runWebpackConfigs');
	let shouldSkip = false;
	t.mock.method(component, 'shouldSkipBuild', async () => shouldSkip);
	const update = t.mock.method(component, 'updateBuildCache', async () => {});

	assert.equal(await component.build(block), true);
	assert.equal(compile.mock.callCount(), 1);
	assert.ok((await fs.stat(path.join(block, 'build/block.json'))).isFile());
	assert.ok(logs.some(entry => entry.type === 'success' && /Built \/blocks\/shared-path in \d+ms/.test(entry.message)), JSON.stringify(logs));
	assert.deepEqual(logs.filter(entry => entry.type === 'error'), []);

	shouldSkip = true;
	assert.equal(await component.build(block), true);
	assert.equal(compile.mock.callCount(), 1, 'a cached block does not compile again');
	assert.equal(update.mock.callCount(), 1);
});

test('one failing or timed-out block does not fail the others', async t => {
	const { root, component, logs } = await setup(t);
	const [good, slow, broken] = await Promise.all(['good', 'slow', 'broken'].map(name => makeBlock(root, name)));
	t.mock.method(component, 'shouldSkipBuild', async () => false);
	t.mock.method(component, 'resolveBlockWebpackConfig', entry => ({ name: entry }));
	t.mock.method(component, 'runWebpackConfigs', async ([config]) => {
		if (config.name === slow) { throw new Error('Build timeout after 60 seconds'); }
		return { stats: [{ hasErrors: () => config.name === broken, toJson: () => ({ errors: [{ message: 'Syntax error' }] }) }] };
	});
	const update = t.mock.method(component, 'updateBuildCache', async () => {});

	const { outcomes, built, attempted } = await component.compileBlocks([good, slow, broken]);
	assert.deepEqual([...outcomes], [[good, 'built'], [slow, 'failed'], [broken, 'failed']].sort((a, b) => [...outcomes.keys()].indexOf(a[0]) - [...outcomes.keys()].indexOf(b[0])));
	assert.equal(built, 1);
	assert.equal(attempted, 3);
	assert.equal(update.mock.callCount(), 1);
	assert.ok(logs.some(entry => entry.type === 'error' && /Failed building \/blocks\/slow block/.test(entry.message)));
	assert.ok(logs.some(entry => entry.type === 'error' && /Failed building \/blocks\/broken block/.test(entry.message)));
	assert.ok(logs.some(entry => /Build timeout after 60 seconds/.test(entry.message)));
	assert.equal(await component.build(slow), false);
});

test('project files webpack read are cached as discovered dependencies and mapped to blocks', async t => {
	const { root, component } = await setup(t);
	const block = await makeBlock(root, 'uses-shared');
	const shared = path.join(root, '_src/scripts/shared.js');
	await fs.mkdir(path.dirname(shared), { recursive: true });
	await fs.writeFile(shared, 'export default 2;');
	t.mock.method(component, 'shouldSkipBuild', async () => false);
	t.mock.method(component, 'resolveBlockWebpackConfig', () => ({}));
	t.mock.method(component, 'runWebpackConfigs', async () => ({
		stats: [{
			hasErrors: () => false,
			compilation: {
				fileDependencies: new Set([
					shared,
					path.join(block, 'src/index.js'),
					path.join(root, 'node_modules/pkg/index.js'),
					path.join(root, 'vendor/lib.php'),
					'/outside/project.js'
				])
			}
		}]
	}));
	const update = t.mock.method(component, 'updateBuildCache', async () => {});

	assert.equal(await component.build(block), true);
	const discovered = update.mock.calls[0].arguments[3];
	assert.ok(discovered.includes(shared));
	assert.ok(discovered.includes(path.join(block, 'src/index.js')));
	assert.ok(!discovered.some(file => /node_modules|vendor|outside/.test(file)));
	assert.deepEqual(component.getAffectedBlocks(shared), new Set([block]));
});

test('stats without compilation data record no extra dependencies', async t => {
	const { component } = await setup(t);
	assert.deepEqual(component.getCompiledProjectFiles(undefined), []);
	assert.deepEqual(component.getCompiledProjectFiles({}), []);
});
