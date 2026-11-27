import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import project from '../lib/project.js';
import tui from '../lib/tui.js';
import ErrorsComponent from '../lib/components/errors.js';
import ServerComponent from '../lib/components/server.js';
import { withProject } from './helpers/index.js';

async function waitFor(predicate, message) {
	const deadline = Date.now() + 8000;
	while (!predicate()) {
		assert.ok(Date.now() < deadline, message);
		await new Promise(resolve => setTimeout(resolve, 25));
	}
}

test('error log lines are classified, de-timestamped and filtered', { timeout: 20000 }, async t => {
	const root = await withProject(t, { isRunning: true });
	t.after(() => { project.isRunning = false; });
	const missing = path.join(root, 'missing.log');
	const log = path.join(root, 'php-error.log');
	await fs.writeFile(log, '');
	project.config = { errorLogPaths: [missing, log] }; // the first candidate is skipped
	const component = new ErrorsComponent();
	const logs = [];
	component.log = (type, message) => logs.push({ type, message });
	await component.watch();
	t.after(() => component.stopWatching());
	await new Promise(resolve => setTimeout(resolve, 300));
	await fs.appendFile(log, [
		'[27-Nov-2026 10:00:00 UTC] PHP Warning:  Undefined variable $x in /a.php on line 3',
		'[27-Nov-2026 10:00:01 UTC] PHP Fatal error:  Uncaught Error in /b.php:9',
		'[27-Nov-2026 10:00:02 UTC] PHP Deprecated:  old function',
		'objectcache.info: cache hit',
		'[27-Nov-2026 10:00:03 UTC] PHP Notice:  plain notice',
		'no timestamp here',
		''
	].join('\n'));
	await waitFor(() => logs.length >= 4, `log lines seen: ${JSON.stringify(logs)}`);
	assert.deepEqual(logs, [
		{ type: 'warn', message: 'PHP Warning:  Undefined variable $x in /a.php on line 3' },
		{ type: 'error', message: 'PHP Fatal error:  Uncaught Error in /b.php:9' },
		{ type: 'php', message: 'PHP Notice:  plain notice' },
		{ type: 'php', message: 'no timestamp here' }
	]);

	// Lines are ignored while paused.
	project.isRunning = false;
	logs.length = 0;
	await fs.appendFile(log, 'PHP Warning:  while paused\nflush\n');
	await new Promise(resolve => setTimeout(resolve, 500));
	assert.deepEqual(logs, []);
});

test('the error log component has no build work and tolerates having nothing configured', async t => {
	await withProject(t, { config: {} });
	const component = new ErrorsComponent();
	const logs = [];
	component.log = (type, message) => logs.push({ type, message });
	assert.equal(await component.init(), undefined);
	assert.equal(await component.build(), undefined);
	assert.equal(await component.process(), undefined);
	await component.watch();
	assert.equal(component.watcher, null);
	assert.match(logs[0].message, /Cannot find error log @ a configured path/);
});

test('the dev server is configured from the project and starts without crashing on bad input', async t => {
	await withProject(t, {
		config: {
			port: 4321,
			php: { enabled: false },
			browsersync: { localProxyURL: 'https://example.test:8443', location: 'end', open: true, tunnel: 'sub', watchEvents: ['change'] }
		}
	});
	const component = new ServerComponent();
	const logs = [];
	component.log = (type, message) => logs.push({ type, message });
	await component.init();
	assert.ok(component.watchedFiles.includes('**/*.php'), 'PHP changes reload the page when the PHP component is disabled');
	assert.match(project.pageScript, /redirectAdminFromPort/);

	let captured;
	let sockets = 0;
	component.server = {
		init: (options, callback) => { captured = options; callback(null, { options: { toJS: () => ({ urls: { local: 'http://localhost:4321' } }) } }); },
		sockets: { on: () => { sockets++; } }
	};
	const env = { key: process.env.SSL_KEY_PATH, cert: process.env.SSL_CRT_PATH };
	process.env.SSL_KEY_PATH = '/tls/key.pem';
	process.env.SSL_CRT_PATH = '/tls/cert.pem';
	t.after(() => {
		for (const [name, value] of [['SSL_KEY_PATH', env.key], ['SSL_CRT_PATH', env.cert]]) {
			if (value === undefined) { delete process.env[name]; } else { process.env[name] = value; }
		}
	});
	component.serve(true);
	assert.equal(captured.port, 4321);
	assert.equal(captured.proxy, 'https://example.test:8443');
	assert.deepEqual(captured.files, component.watchedFiles);
	assert.deepEqual(captured.watchEvents, ['change']);
	assert.equal(captured.open, true);
	assert.equal(captured.tunnel, 'sub');
	assert.deepEqual(captured.https, { key: '/tls/key.pem', cert: '/tls/cert.pem' });
	assert.equal(sockets, 1);

	const { rule } = captured.snippetOptions;
	assert.equal(rule.match.test('</body>'), true);
	const injected = rule.fn('<script>bs</script>', '</body>');
	assert.ok(injected.startsWith('<script>bs</script>'));
	assert.match(injected, /localProxyURLWithPreSuf = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzexample\.test:8443'/);
	assert.ok(injected.endsWith('</body>'), 'location "end" appends the original match after the scripts');

	component.serve(false);
	assert.deepEqual(captured.files, []);

	component.server = { init: (options, callback) => callback(null, { options: { toJS: () => ({}) } }), sockets: { on: () => { throw new Error('no sockets'); } } };
	component.serve();
	assert.ok(logs.some(entry => entry.type === 'error' && /Failed to setup socket handlers: no sockets/.test(entry.message)));
});

test('the default snippet location injects scripts right after the opening body tag', async t => {
	await withProject(t, { config: { browsersync: { localProxyURL: 'http://site.test' }, php: { enabled: true } } });
	const component = new ServerComponent();
	component.log = () => {};
	await component.init();
	assert.ok(!component.watchedFiles.includes('**/*.php'));
	let captured;
	component.server = { init: options => { captured = options; } };
	component.serve();
	const { rule } = captured.snippetOptions;
	assert.equal(rule.match.test('<body class="home">'), true);
	const injected = rule.fn('SNIPPET', '<body class="home">');
	assert.ok(injected.startsWith('<body class="home">SNIPPET'));
	assert.match(injected, /window\.localProxyURL = window\.localProxyURLWithPreSuf\.replace/);
	assert.equal(captured.https, false);
});

test('server URLs are logged to the console or handed to the TUI', async t => {
	await withProject(t, { config: {} });
	const component = new ServerComponent();
	const logs = [];
	component.log = (type, message) => logs.push({ type, message });
	component.usedOptions = {};
	assert.doesNotThrow(() => component.logURLs());
	assert.deepEqual(logs, []);

	component.usedOptions = {
		urls: { local: 'http://localhost:3000', external: 'http://192.168.0.5:3000' },
		proxy: { url: { hostname: 'example.test' } }
	};
	component.logURLs();
	assert.match(logs[0].message, /Local server:\s+.*http:\/\/example\.test:3000.*\(http:\/\/localhost:3000\)/);
	assert.match(logs[1].message, /External server:\s+.*http:\/\/192\.168\.0\.5:3000/);

	const original = Object.getOwnPropertyDescriptor(tui, 'isInitialized');
	const setURLs = t.mock.method(tui, 'setURLs', () => {});
	Object.defineProperty(tui, 'isInitialized', { value: true, configurable: true });
	t.after(() => {
		if (original) { Object.defineProperty(tui, 'isInitialized', original); } else { delete tui.isInitialized; }
	});
	component.logURLs();
	assert.deepEqual(setURLs.mock.calls[0].arguments, ['http://example.test:3000', 'http://192.168.0.5:3000']);
	component.usedOptions = { urls: { local: 'http://localhost:3000' } };
	component.logURLs();
	assert.deepEqual(setURLs.mock.calls[1].arguments, ['http://localhost:3000', '']);
});
