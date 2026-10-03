import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import project from '../lib/project.js';
import StyleComponent from '../lib/components/style.js';

test('Sass dependency replacement removes stale reverse mappings and keeps shared entries', async t => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-style-'));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	const first = path.join(root, 'first.scss');
	const second = path.join(root, 'second.scss');
	await fs.writeFile(first, '@use "partials/shared";');
	await fs.writeFile(second, '@use "partials/shared";');
	const component = new StyleComponent();
	component.files = [{ file: first }, { file: second }];
	await component.rebuildDependencyGraph();
	const shared = path.join(root, 'partials/_shared.scss');
	assert.deepEqual(component.getAffectedEntries(shared), [first, second]);
	assert.deepEqual(component.getAffectedEntries(first), [first]);
	await fs.writeFile(first, '@use "partials/new";');
	await component.rebuildDependencyGraph([first]);
	assert.deepEqual(component.getAffectedEntries(shared), [second]);
	assert.deepEqual(component.getAffectedEntries(path.join(root, 'partials/_new.scss')), [first]);
	component.clearDependencyEntry(second);
	assert.deepEqual(component.getAffectedEntries(shared), []);
	await component.rebuildDependencyGraph([]);
});

test('style processing stops on lint failure and builds only selected entries with matching output names', async t => {
	assert.ok(project);
	const component = new StyleComponent();
	component.files = [{ file: 'first.scss', name: 'style/first' }, { file: 'second.scss', name: 'style/second' }];
	component.globs = ['first.scss', 'second.scss'];
	const theme = t.mock.method(component, 'buildTheme', async () => {});
	const lint = t.mock.method(component, 'lint', async () => false);
	const build = t.mock.method(component, 'build', async () => true);
	assert.equal(await component.process(), false);
	assert.equal(build.mock.calls.length, 0);
	t.mock.method(component, 'lint', async () => true);
	await component.processEntries(['second.scss'], { buildTheme: false, lintTargets: ['dependency.scss'] });
	assert.deepEqual(build.mock.calls[0].arguments, ['second.scss', { name: 'style/second' }]);
	assert.equal(theme.mock.calls.length, 1);
	assert.deepEqual(lint.mock.calls[0].arguments, [component.globs]);
	assert.deepEqual(await component.processEntries(['absent'], { buildTheme: false }), []);
	assert.equal(await component.lint([]), true);
});

test('style compilation and theme generation failures report errors without updating cache', async t => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-style-errors-'));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	const component = new StyleComponent();
	component.project = { ...project, path: root, paths: { ...project.paths, theme: { json: path.join(root, 'theme.json'), scss: path.join(root, '_theme.scss') } } };
	const logs = [];
	component.log = (type, message) => logs.push({ type, message });
	t.mock.method(component, 'shouldSkipBuild', async () => false);
	const cache = t.mock.method(component, 'updateBuildCache', async () => {});
	const source = path.join(root, 'invalid.scss');
	await fs.writeFile(source, '.invalid { color: $undefined; }');
	assert.equal(await component.build(source, { name: 'style/invalid' }), false);
	assert.equal(cache.mock.calls.length, 0);
	await component.buildTheme();
	assert.ok(logs.some(log => log.type === 'error' && /Failed to read theme.json/.test(log.message)));
	assert.ok(logs.some(log => log.type === 'error' && /Failed building/.test(log.message)));
});
