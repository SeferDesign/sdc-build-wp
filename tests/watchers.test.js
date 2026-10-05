import assert from 'node:assert/strict';
import { test } from 'node:test';
import project from '../lib/project.js';
import ImagesComponent from '../lib/components/images.js';
import FontsComponent from '../lib/components/fonts.js';
import HTMLComponent from '../lib/components/html.js';
import PHPComponent from '../lib/components/php.js';
import StyleComponent from '../lib/components/style.js';
import CacheComponent from '../lib/components/cache.js';
import ServerComponent from '../lib/components/server.js';

function watchHarness(Component) {
	const component = new Component();
	component.project = { ...project, isRunning: false };
	const handlers = new Map();
	const watcher = { on: (event, callback) => { handlers.set(event, callback); return watcher; } };
	component.chokidar = { watch: () => watcher };
	const logs = [];
	component.log = (type, message) => logs.push({ type, message });
	component.watch();
	return { component, handlers, logs };
}

for (const Component of [ImagesComponent, FontsComponent, HTMLComponent, PHPComponent]) {
	test(`${Component.name} watcher respects pause, dispatches changes and reports processing failures`, async t => {
		const { component, handlers, logs } = watchHarness(Component);
		const process = t.mock.method(component, 'process', async () => {});
		const callback = handlers.get('all');
		const entry = Component === PHPComponent
			? `${component.project.path}/file.php`
			: Component === HTMLComponent ? `${component.project.path}/file.html`
				: Component === FontsComponent ? `${component.project.path}/_src/fonts/file.woff2` : '/source/file';
		await callback('change', entry);
		assert.equal(process.mock.calls.length, 0);
		component.project.isRunning = true;
		await callback('change', entry);
		assert.equal(process.mock.calls.length, 1);
		if (Component !== FontsComponent) {
			const remove = Component === ImagesComponent ? t.mock.method(component, 'remove', async () => {}) : null;
			await callback('unlink', entry);
			assert.equal(process.mock.calls.length, 1);
			if (remove) { assert.equal(remove.mock.calls.length, 1); }
		}
		if (Component === PHPComponent) {
			await callback('change', '/theme/blocks/example/build/render.php');
			assert.equal(process.mock.calls.length, 1);
		}
		t.mock.method(component, 'process', async () => { throw new Error('watch failure'); });
		await callback('change', entry);
		assert.ok(logs.some(log => log.type === 'error' && /watch failure/.test(log.message)));
	});
}

test('style watcher routes theme, dependency, deletion and untracked changes', async t => {
	const { component, handlers, logs } = watchHarness(StyleComponent);
	component.project.isRunning = true;
	const sourceRoot = `${component.project.path}/${component.project.paths.src.src}/${component.project.paths.src.style}`;
	const main = `${sourceRoot}/main.scss`;
	const tokens = `${sourceRoot}/partials/_tokens.scss`;
	const untracked = `${sourceRoot}/partials/_untracked.scss`;
	component.files = [{ file: main }];
	component.setDependencyEntry(main, [tokens]);
	const process = t.mock.method(component, 'process', async () => {});
	const entries = t.mock.method(component, 'processEntries', async () => {});
	const graph = t.mock.method(component, 'rebuildDependencyGraph', async () => {});
	const callback = handlers.get('all');
	await callback('change', component.project.paths.theme.json);
	assert.deepEqual(process.mock.calls[0].arguments, [null, { buildTheme: true }]);
	await callback('change', tokens);
	assert.deepEqual(entries.mock.calls[0].arguments, [[main], { buildTheme: false, lintTargets: [tokens] }]);
	await callback('unlink', tokens);
	await callback('change', untracked);
	assert.equal(process.mock.calls.length, 2);
	assert.deepEqual(entries.mock.calls[1].arguments, [null, { buildTheme: false, lintTargets: [untracked] }]);
	assert.equal(graph.mock.calls.length, 3);
	t.mock.method(component, 'processEntries', async () => { throw new Error('style watcher failed'); });
	await callback('change', untracked);
	assert.ok(logs.some(log => /style watcher failed/.test(log.message)));
});

test('cache watcher invalidates changed and deleted files', async t => {
	const { component, handlers } = watchHarness(CacheComponent);
	const invalidate = t.mock.method(component, 'invalidateFile', async () => {});
	const changed = `${component.project.path}/changed.js`;
	const deleted = `${component.project.path}/deleted.js`;
	await handlers.get('all')('change', changed);
	await handlers.get('all')('unlink', deleted);
	assert.deepEqual(invalidate.mock.calls.map(call => call.arguments), [[changed], [deleted]]);
});

test('server watcher routes reloads, respects pause and surfaces reload and startup failures', async t => {
	const component = new ServerComponent();
	component.project = { ...project, isRunning: false };
	let callback;
	const reloads = [];
	const notifications = [];
	const logs = [];
	component.log = (type, message) => logs.push({ type, message });
	component.server = {
		watch: (files, options, handler) => { callback = handler; },
		reload: file => reloads.push(file),
		notify: message => notifications.push(message)
	};
	await component.watch();
	callback('change', 'style.css');
	assert.equal(reloads.length, 0);
	component.project.isRunning = true;
	callback('change', 'style.css');
	callback('add', 'script.js');
	callback('unlink', 'deleted.js');
	assert.deepEqual(reloads, ['style.css', 'script.js', undefined]);
	assert.deepEqual(notifications, ['Style updated', 'Reloading...', 'Reloading...']);
	t.mock.method(component.server, 'reload', () => { throw new Error('reload failed'); });
	callback('change', 'script.js');
	assert.ok(logs.some(log => log.type === 'warn' && /reload failed/.test(log.message)));
	t.mock.method(component.server, 'watch', () => { throw new Error('startup failed'); });
	await assert.rejects(component.watch(), /startup failed/);
	assert.ok(logs.some(log => log.type === 'error' && /startup failed/.test(log.message)));
});

test('server socket messages preserve per-session script lists and report redirects', () => {
	const component = new ServerComponent();
	let connection;
	const events = new Map();
	const logs = [];
	component.log = (type, message) => logs.push(message);
	component.server = { sockets: { on: (event, handler) => { connection = handler; } } };
	component.setupSocketHandlers(component);
	connection({ on: (event, handler) => events.set(event, handler) });
	events.get('sdc:scriptsOnPage')({ sessionID: 'first', data: ['one.js'] });
	events.get('sdc:scriptsOnPage')({ sessionID: 'second', data: ['two.js'] });
	events.get('sdc:scriptsOnPage')({ sessionID: 'first', data: ['updated.js'] });
	assert.deepEqual(component.sessions, { first: { scripts: ['updated.js'] }, second: { scripts: ['two.js'] } });
	events.get('sdc:redirectAdminFromPort')({ port: 3000, from: '/from', to: '/to' });
	assert.match(logs[0], /3000.*\/from.*\/to/);
});
