import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { extractWordPressStyles, rewriteCSS, loadWordPressTheme } from '../lib/storybook/wordpress.js';
import { storybookOptions, stopStorybook } from '../lib/storybook/server.js';
import { validateConfig, mergeWithDefaults, getDefaultConfig } from '../lib/config-validator.js';
import project from '../lib/project.js';
import StyleComponent from '../lib/components/style.js';

test('WordPress extraction preserves enqueue order, inline global styles, media, and body classes without scripts', () => {
	const html = `<html><head>
		<link href="/theme.css?ver=2&amp;test=1" rel="stylesheet" id="theme-css" media="screen">
		<script>alert('not included')</script>
		<style id="global-styles-inline-css">body { color: var(--wp--preset--color--primary); background: url('./image.png'); }</style>
		<link rel="alternate stylesheet" href="//wp.local/block.css">
	</head><body class="home wp-custom">
		<style>.block { color: red; }</style>
	</body></html>`;
	const data = extractWordPressStyles(html, 'http://wp.local/page/');
	assert.equal(data.bodyClasses, 'home wp-custom');
	assert.deepEqual(data.styles.map(style => style.tag), ['link', 'style', 'link', 'style']);
	assert.equal(data.styles[0].href, 'http://wp.local/theme.css?ver=2&test=1');
	assert.equal(data.styles[0].media, 'screen');
	assert.equal(data.styles[1].id, 'global-styles-inline-css');
	assert.match(data.styles[1].css, /url\("http:\/\/wp.local\/page\/image.png"\)/);
	assert.equal(data.styles[2].href, 'http://wp.local/block.css');
	assert.throws(() => extractWordPressStyles('<html></html>', 'http://wp.local/'), /did not contain/);
	assert.throws(() => extractWordPressStyles('<link rel="stylesheet" href="javascript:alert(1)">', 'http://wp.local/'), /Unsupported/);
});

test('inline CSS resolves fonts, imports and base URLs while preserving fragments and data URLs', () => {
	const css = rewriteCSS(`@import "./other.css";
		@font-face { src: url('../fonts/theme.woff2'); }
		.icon { filter: url(#icon); background: url("data:image/png;base64,abc"); }`, 'https://wp.local/page/');
	assert.match(css, /@import "https:\/\/wp.local\/page\/other.css"/);
	assert.match(css, /https:\/\/wp.local\/fonts\/theme.woff2/);
	assert.match(css, /url\(#icon\)/);
	assert.match(css, /data:image\/png;base64,abc/);
	const data = extractWordPressStyles('<base href="/assets/"><link rel="stylesheet" href="theme.css">', 'https://wp.local/page/');
	assert.equal(data.styles[0].href, 'https://wp.local/assets/theme.css');
});

test('Storybook defaults to enabled, supports opting out and validates source and port configuration', async t => {
	assert.equal(getDefaultConfig().storybook.enabled, true);
	assert.equal(mergeWithDefaults({}).storybook.enabled, true);
	assert.equal(mergeWithDefaults({ storybook: { port: 6106 } }).storybook.enabled, true);
	assert.equal(mergeWithDefaults({ storybook: { enabled: false } }).storybook.enabled, false);
	assert.equal(validateConfig({ storybook: { enabled: true, sourceURL: 'http://wp.local/', port: 6006 } }), true);
	const output = [];
	t.mock.method(console, 'log', value => output.push(value));
	t.mock.method(console, 'error', value => output.push(value));
	assert.equal(validateConfig({ storybook: { enabled: 'yes' } }), false);
	assert.equal(validateConfig({ storybook: { port: '6006' } }), false);
	assert.deepEqual(storybookOptions({ config: { browsersync: { localProxyURL: 'http://wp.local/' } } }), { sourceURL: 'http://wp.local/', port: 6006 });
	assert.equal(storybookOptions({ config: { storybook: { sourceURL: 'http://override.local/', port: 6106 } } }).port, 6106);
	assert.throws(() => storybookOptions({ config: {} }), /needs storybook.sourceURL/);
	assert.throws(() => storybookOptions({ config: { storybook: { sourceURL: 'http://wp.local/', port: 0 } } }), /port must/);
	const component = new StyleComponent();
	component.project = { ...project, config: mergeWithDefaults({ storybook: { enabled: false } }), chokidarOpts: {} };
	const watcher = { on: () => watcher };
	component.chokidar = { watch: () => watcher };
	await component.watch();
	assert.equal(component.storybookProcess, undefined);
	await component.stop();
});

test('WordPress source reads local theme.json and reports HTTP and JSON failures', async t => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-storybook-source-'));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	await fs.writeFile(path.join(root, 'theme.json'), '{"settings":{"color":{"palette":[]}}}');
	let status = 200;
	const server = createServer((request, response) => {
		response.writeHead(status, { 'Content-Type': 'text/html' });
		response.end('<style>body { color: red; }</style>');
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	t.after(() => new Promise(resolve => server.close(resolve)));
	const url = `http://127.0.0.1:${server.address().port}/`;
	const data = await loadWordPressTheme(root, url);
	assert.deepEqual(data.themeJSON.settings.color.palette, []);
	assert.equal(data.styles.length, 1);
	status = 503;
	await assert.rejects(loadWordPressTheme(root, url), /HTTP 503/);
	await assert.rejects(loadWordPressTheme(root, 'file:///theme'), /HTTP or HTTPS/);
	await fs.writeFile(path.join(root, 'theme.json'), '{invalid');
	await assert.rejects(loadWordPressTheme(root, url), SyntaxError);
});

test('Storybook child shutdown waits for exit and is safe to repeat', async () => {
	const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
	await once(child, 'spawn');
	await stopStorybook(child);
	assert.notEqual(child.signalCode, null);
	await stopStorybook(child);
	await stopStorybook(null);
});

test('real Storybook dev server indexes built-in and theme stories and serves fresh WordPress styles', { timeout: 150000 }, async t => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-storybook-dev-'));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	await fs.mkdir(path.join(root, '_src/style'), { recursive: true });
	await fs.writeFile(path.join(root, 'theme.json'), '{"settings":{"color":{"palette":[{"slug":"primary","color":"#123456"}]}}}');
	await fs.writeFile(path.join(root, '_src/style/example.stories.js'), 'export default { title: \'Custom/Example\' }; export const Example = { render: () => \'<p>Custom story</p>\' };');
	let color = '#123456';
	const wordpress = createServer((request, response) => {
		response.writeHead(200, { 'Content-Type': 'text/html' });
		response.end(`<link rel="stylesheet" href="/theme.css"><style id="global-styles-inline-css">:root { --wp--preset--color--primary: ${color}; }</style>`);
	});
	wordpress.listen(0, '127.0.0.1');
	await once(wordpress, 'listening');
	t.after(() => new Promise(resolve => wordpress.close(resolve)));
	const portProbe = createServer();
	portProbe.listen(0, '127.0.0.1');
	await once(portProbe, 'listening');
	const port = portProbe.address().port;
	await new Promise(resolve => portProbe.close(resolve));
	const logs = [];
	let child;
	t.after(() => stopStorybook(child));
	const component = new StyleComponent();
	component.project = {
		...project,
		path: root,
		config: mergeWithDefaults({ storybook: { sourceURL: `http://127.0.0.1:${wordpress.address().port}/`, port } })
	};
	component.log = (type, message) => logs.push(message);
	const watcher = { on: () => watcher };
	component.chokidar = { watch: () => watcher };
	t.after(() => component.stop());
	await component.watch();
	child = component.storybookProcess;
	assert.ok(child?.pid);
	const url = `http://127.0.0.1:${port}`;
	const index = await fetch(`${url}/index.json`).then(response => response.json());
	assert.ok(index.entries['wordpress-theme--colors'], JSON.stringify(index.entries));
	assert.ok(Object.values(index.entries).some(entry => entry.title === 'Custom/Example'));
	const data = await fetch(`${url}/sdc-wordpress-theme`).then(response => response.json());
	assert.equal(data.themeJSON.settings.color.palette[0].color, '#123456');
	assert.match(data.styles[1].css, /#123456/);
	color = '#abcdef';
	const refreshed = await fetch(`${url}/sdc-wordpress-theme`).then(response => response.json());
	assert.match(refreshed.styles[1].css, /#abcdef/);
	const iframe = await fetch(`${url}/iframe.html`);
	assert.equal(iframe.status, 200);
	assert.ok(logs.some(message => message.includes(`Storybook: ${url}`)));
});
