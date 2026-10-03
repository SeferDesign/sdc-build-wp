import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import project from '../lib/project.js';
import ScriptsComponent from '../lib/components/scripts.js';

test('scripts resolve dependencies once per processed entry and refresh after lint fixes', async t => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-scripts-test-'));
	const originalPath = project.path;
	project.path = directory;
	t.after(async () => {
		project.path = originalPath;
		await fs.rm(directory, { recursive: true, force: true });
	});
	const entry = path.join(directory, 'entry.js');
	const otherEntry = path.join(directory, 'other.js');
	const firstDependency = path.join(directory, 'first.js');
	const secondDependency = path.join(directory, 'second.js');
	const nestedDependency = path.join(directory, 'nested.js');
	await Promise.all([
		fs.writeFile(entry, 'import value from "./first.js";'),
		fs.writeFile(otherEntry, 'console.log("other");'),
		fs.writeFile(firstDependency, 'export default 1;'),
		fs.writeFile(secondDependency, 'import value from "./nested.js"; export default value;'),
		fs.writeFile(nestedDependency, 'export default 2;')
	]);
	const component = new ScriptsComponent();
	component.files = [{ file: entry }, { file: otherEntry }];
	component.globs = [entry, otherEntry, firstDependency, secondDependency, nestedDependency];
	let resolutions = 0;
	component.utils = {
		...component.utils,
		getAllJSDependencies: async file => {
			resolutions++;
			return component.utils.originalGetDependencies(file);
		},
		originalGetDependencies: component.utils.getAllJSDependencies
	};
	t.mock.method(component, 'lint', async () => true);
	t.mock.method(component, 'shouldSkipBuild', async () => true);
	t.mock.method(component, 'end', () => {});
	await component.process();
	assert.equal(resolutions, 2);
	assert.deepEqual(component.getAffectedEntries(firstDependency), [entry]);
	await component.build(entry);
	assert.equal(resolutions, 2);

	t.mock.method(component, 'lint', async () => {
		await fs.writeFile(entry, 'import value from "./second.js";');
		return true;
	});
	await component.process([entry], { lintTargets: [entry] });
	assert.equal(resolutions, 3);
	assert.deepEqual(component.getAffectedEntries(firstDependency), []);
	assert.deepEqual(component.getAffectedEntries(secondDependency), [entry]);
	assert.deepEqual(component.getAffectedEntries(nestedDependency), [entry]);
	assert.deepEqual(component.dependencyGraph.get(otherEntry), []);
	assert.equal(component.isBuilding, false);
});

test('scripts keep isBuilding true until all scheduled entries finish', async t => {
	const component = new ScriptsComponent();
	component.files = [{ file: 'entry.js' }];
	t.mock.method(component, 'lint', async () => true);
	t.mock.method(component, 'rebuildDependencyGraph', async () => {});
	let release;
	const gate = new Promise(resolve => { release = resolve; });
	t.mock.method(component, 'build', () => gate);
	const processing = component.process();
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(component.isBuilding, true);
	release();
	await processing;
	assert.equal(component.isBuilding, false);
});

test('script processing clears building state on lint and build failures', async t => {
	const component = new ScriptsComponent();
	component.files = [{ file: 'entry.js' }];
	t.mock.method(component, 'lint', async () => new Error('lint failed'));
	await assert.rejects(component.process(), /lint failed/);
	assert.equal(component.isBuilding, false);
	t.mock.method(component, 'lint', async () => true);
	t.mock.method(component, 'rebuildDependencyGraph', async () => {});
	t.mock.method(component, 'build', async () => { throw new Error('build failed'); });
	await assert.rejects(component.process(), /build failed/);
	assert.equal(component.isBuilding, false);
	assert.deepEqual(await component.process(['absent.js']), []);
	assert.equal(component.isBuilding, false);
});
