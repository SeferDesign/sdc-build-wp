import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Ajv from 'ajv';
import configSchema from '../config.schema.json' with { type: 'json' };
import { createServer } from 'node:http';
import { validateWordPress, logValidation, watchWordPressValidation } from '../lib/validation.js';
import chokidar from 'chokidar';
import { EventEmitter } from 'node:events';
import { detectWordPressVersion, loadWordPressSchemas, schemaVersion } from '../lib/wordpress-schemas.js';

const themeSchema = {
	type: 'object', required: ['version'],
	properties: {
		version: { type: 'integer' },
		settings: {
			type: 'object', properties: {
				color: {
					type: 'object', properties: {
						palette: { type: 'array', items: {
							type: 'object', required: ['slug', 'name', 'color'], additionalProperties: false,
							properties: { slug: { type: 'string' }, name: { type: 'string' }, color: { type: 'string' } }
						} }
					}
				}
			}
		}
	}
};
const blockSchema = { type: 'object', required: ['name', 'title'], properties: { name: { type: 'string' }, title: { type: 'string' } } };

async function setup(t) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-validation-'));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	t.mock.method(globalThis, 'fetch', async url => new Response(JSON.stringify(url.endsWith('/theme.json') ? themeSchema : blockSchema)));
	const write = async (name, data) => {
		const file = path.join(root, name);
		await fs.mkdir(path.dirname(file), { recursive: true });
		await fs.writeFile(file, typeof data === 'string' ? data : JSON.stringify(data));
	};
	const validate = async () => {
		await write('wp-includes/version.php', '<?php\n$wp_version = "6.8";');
		return validateWordPress({ root });
	};
	return { root, write, validate };
}

test('schema diagnostics identify JSON properties and source assets may be deferred', async t => {
	const { write, validate } = await setup(t);
	await write('theme.json', { version: 3, settings: { color: { palette: [{ slug: 'brand', name: 'Brand', colour: '#fff' }] } } });
	await write('blocks/example/src/block.json', { name: 'fixture/example', title: 'Example', editorScript: 'file:./index.js', style: 'file:./style-index.css', render: 'file:./render.php' });
	await write('blocks/example/src/render.php', '<?php');
	const { diagnostics } = await validate();
	assert.ok(diagnostics.some(item => item.severity === 'error' && item.file === 'theme.json' && item.pointer.includes('/settings/color/palette')));
	assert.equal(diagnostics.filter(item => item.file.includes('block.json') && item.severity === 'error').length, 0);
	assert.equal(diagnostics.filter(item => item.severity === 'warn').length, 0);
});

test('source validation checks duplicate names and render files while ignoring compiled metadata', async t => {
	const { write, validate } = await setup(t);
	await write('blocks/first/src/block.json', { name: 'fixture/duplicate', title: 'First', editorScript: ['wp-element', 'file:./index.js'], render: 'file:./render.php' });
	await write('blocks/first/build/block.json', 'not valid JSON');
	await write('blocks/second/src/block.json', { name: 'fixture/duplicate', title: 'Second', style: 'file:./missing.css' });
	const { diagnostics } = await validate();
	assert.ok(diagnostics.some(item => item.pointer === '/name' && /Duplicate/.test(item.message)));
	assert.ok(diagnostics.some(item => item.pointer === '/render' && item.severity === 'error'));
	assert.equal(diagnostics.some(item => item.pointer === '/style'), false);
	assert.equal(diagnostics.some(item => item.file.includes('/build/')), false);
});

test('theme checks local fonts variation assets template declarations and Sass collisions', async t => {
	const { write, validate } = await setup(t);
	await write('theme.json', {
		version: 3,
		settings: {
			custom: { brand_color: '#fff' },
			color: { palette: [{ slug: 'brand-color', name: 'Brand', color: '#fff' }] },
			typography: { fontFamilies: [{ slug: 'body', name: 'Body', fontFamily: 'Body', fontFace: [{ fontFamily: 'Body', src: ['file:./assets/body.woff2'] }] }] }
		},
		templateParts: [{ name: 'header', title: 'Header' }]
	});
	await write('styles/dark.json', { title: 'Dark', styles: { background: { backgroundImage: { url: 'file:./assets/background.png' } } } });
	const { diagnostics } = await validate();
	assert.ok(diagnostics.some(item => /collides/.test(item.message)));
	assert.ok(diagnostics.some(item => /body.woff2/.test(item.message)));
	assert.ok(diagnostics.some(item => item.file === 'styles/dark.json' && /background.png/.test(item.message)));
	assert.ok(diagnostics.some(item => /parts\/header.html/.test(item.message) && item.severity === 'warn'));
});

test('WordPress version is detected in ancestors and symlinks without executing PHP', async t => {
	const { root, write } = await setup(t);
	await write('site/wp-includes/version.php', '<?php\n$wp_version = \'6.7.2\';\nthrow new Exception("must not execute");');
	const theme = path.join(root, 'site/wp-content/themes/example');
	await fs.mkdir(theme, { recursive: true });
	assert.equal((await detectWordPressVersion({ root: theme })).version, '6.7.2');
	const alias = path.join(root, 'linked-theme');
	await fs.symlink(theme, alias, 'dir');
	assert.equal((await detectWordPressVersion({ root: alias })).version, '6.7.2');
	await assert.rejects(detectWordPressVersion({ root }), /Cannot detect WordPress/);
	assert.equal(schemaVersion('6.7.2'), '6.7');
	assert.equal(schemaVersion('6.9-beta1'), '6.9');
	assert.throws(() => schemaVersion('../../latest'), /Invalid detected WordPress version/);
});

test('schemas download per version and are reused offline', async t => {
	const { root } = await setup(t);
	const urls = [];
	const fetcher = async url => {
		urls.push(url);
		return new Response(JSON.stringify(url.endsWith('/theme.json') ? themeSchema : blockSchema));
	};
	await loadWordPressSchemas({ root, version: '6.7.2', fetcher });
	await loadWordPressSchemas({ root, version: '6.8', fetcher });
	assert.equal(urls.length, 4);
	assert.ok(urls.includes('https://schemas.wp.org/wp/6.7/theme.json'));
	const offline = async () => { throw new Error('offline'); };
	assert.equal((await loadWordPressSchemas({ root, version: '6.7.9', fetcher: offline })).version, '6.7');
	await loadWordPressSchemas({ root, version: '6.7', fetcher });
	assert.equal(urls.length, 4);
	await assert.rejects(loadWordPressSchemas({ root, version: '6.9', fetcher: offline }), /No other WordPress version was substituted/);
	const cacheDir = path.join(root, '.sdc-build-wp/cache/schemas');
	assert.equal((await fs.readdir(cacheDir)).length, 4);
});

test('invalid downloads never become cached schemas and corrupt cache entries are repaired', async t => {
	const { root } = await setup(t);
	const cacheDir = path.join(root, '.sdc-build-wp/cache/schemas');
	await fs.mkdir(cacheDir, { recursive: true });
	await fs.writeFile(path.join(cacheDir, 'wordpress-6.8-theme.json'), '<html>broken</html>');
	await loadWordPressSchemas({ root, version: '6.8' });
	assert.equal(JSON.parse(await fs.readFile(path.join(cacheDir, 'wordpress-6.8-theme.json'), 'utf8')).type, 'object');
	await assert.rejects(loadWordPressSchemas({ root, version: '6.9', fetcher: async () => new Response('<html>not JSON</html>') }), /Cannot load WordPress 6.9/);
	await assert.rejects(fs.stat(path.join(cacheDir, 'wordpress-6.9-theme.json')), { code: 'ENOENT' });
	await assert.rejects(loadWordPressSchemas({ root, version: '7.0', fetcher: async () => new Response('', { status: 404 }) }), /HTTP 404/);
});

test('normal builds automatically validate the installed WordPress version and follow upgrades', async t => {
	const { root, write } = await setup(t);
	const theme = path.join(root, 'site/wp-content/themes/example');
	await write('site/wp-includes/version.php', '<?php\n$wp_version = "6.7.2";');
	await write('site/wp-content/themes/example/package.json', { name: 'fixture-validation' });
	await write('site/wp-content/themes/example/theme.json', { version: 3 });
	await loadWordPressSchemas({ root: theme, version: '6.7' });
	const before = await fs.readdir(theme);
	const cli = new URL('../index.js', import.meta.url).pathname;
	const { stdout } = await promisify(execFile)(process.execPath, [cli, '--builds=scripts', '--no-cache'], { cwd: theme, timeout: 15000 });
	assert.equal((await validateWordPress({ root: theme })).wordpressVersion, '6.7.2');
	assert.doesNotMatch(stdout, /using .* schemas|wp-includes\/version.php/);
	assert.match(stdout, /Validated 1 file/);
	assert.deepEqual(await fs.readdir(theme), before);
	await loadWordPressSchemas({ root: theme, version: '6.8' });
	await write('site/wp-includes/version.php', '<?php\n$wp_version = "6.8.3";');
	const upgraded = await promisify(execFile)(process.execPath, [cli, '--builds=scripts', '--no-cache'], { cwd: theme, timeout: 15000 });
	assert.equal((await validateWordPress({ root: theme })).wordpressVersion, '6.8.3');
	assert.match(upgraded.stdout, /Validated 1 file/);
});

test('normal builds stop on metadata errors before compilation without an enable setting', async t => {
	const { root, write } = await setup(t);
	await loadWordPressSchemas({ root, version: '6.8' });
	await write('package.json', { name: 'fixture-validation' });
	await write('wp-includes/version.php', '<?php\n$wp_version = "6.8";');
	await write('theme.json', { version: 'invalid' });
	const cli = new URL('../index.js', import.meta.url).pathname;
	await assert.rejects(promisify(execFile)(process.execPath, [cli, '--builds=style', '--no-cache'], { cwd: root, timeout: 15000 }), error => {
		assert.equal(error.code, 1);
		assert.match(error.stderr, /theme.json \(\/version\)/);
		return true;
	});
	await assert.rejects(fs.stat(path.join(root, 'dist')), { code: 'ENOENT' });
});

test('concurrent schema requests share downloads and invalid schema objects are rejected', async t => {
	const { root } = await setup(t);
	let downloads = 0;
	const fetcher = async url => {
		downloads++;
		return new Response(JSON.stringify(url.endsWith('/theme.json') ? themeSchema : blockSchema));
	};
	await Promise.all([
		loadWordPressSchemas({ root, version: '6.8.1', fetcher }),
		loadWordPressSchemas({ root, version: '6.8.3', fetcher })
	]);
	assert.equal(downloads, 2);
	await assert.rejects(loadWordPressSchemas({ root, version: '6.9', fetcher: async () => new Response('{}') }), /not a WordPress object schema/);
	const cacheDir = path.join(root, '.sdc-build-wp/cache/schemas');
	assert.equal((await fs.readdir(cacheDir)).some(file => file.endsWith('.tmp')), false);
});

test('normal block builds validate source only and allow future compiled assets', { timeout: 45000 }, async t => {
	const { root, write } = await setup(t);
	await loadWordPressSchemas({ root, version: '6.8' });
	await write('package.json', { name: 'fixture-validation', private: true, browserslist: ['defaults'] });
	await write('wp-includes/version.php', '<?php\n$wp_version = "6.8";');
	await write('blocks/example/src/block.json', { apiVersion: 3, name: 'fixture/example', title: 'Example', category: 'widgets', editorScript: 'file:./index.js', style: 'file:./missing.css' });
	await write('blocks/example/src/index.js', 'window.validationFixture = true;');
	const cli = new URL('../index.js', import.meta.url).pathname;
	const { stdout, stderr } = await promisify(execFile)(process.execPath, [cli, '--builds=blocks', '--no-cache'], { cwd: root, timeout: 30000 });
	assert.doesNotMatch(stderr, /may be generated during compilation/);
	assert.match(stdout, /Finished initial build/);
	assert.ok((await fs.stat(path.join(root, 'blocks/example/build/index.js'))).isFile());
});

test('removed validation commands and flags are rejected', async t => {
	const { root, write } = await setup(t);
	await write('package.json', { name: 'fixture-validation' });
	const cli = new URL('../index.js', import.meta.url).pathname;
	for (const option of ['validate', '--validate', '--no-validate', '--built', '--wordpress-version=6.8', '--wordpress-path=..', '--refresh-schemas']) {
		await assert.rejects(promisify(execFile)(process.execPath, [cli, option], { cwd: root, timeout: 15000 }), error => {
			assert.equal(error.code, 1, option);
			assert.match(error.stderr, /Unknown (argument|command)/);
			return true;
		});
	}
	const { stdout } = await promisify(execFile)(process.execPath, [cli, '--help'], { cwd: root, timeout: 15000 });
	assert.doesNotMatch(stdout, /--validate|--built|--wordpress-version|--wordpress-path|--refresh-schemas/);
});

test('validation configuration cannot disable checks or override the detected installation', () => {
	const validate = new Ajv().compile(configSchema);
	assert.equal(validate({}), true);
	for (const validation of [{ schemaCacheDir: 'cache/schemas' }, { enabled: false }, { wordpressVersion: '6.8' }, { wordpressPath: '..' }, { refreshSchemas: true }, { phase: 'built' }]) {
		assert.equal(validate({ validation }), false, JSON.stringify(validation));
	}
});

test('normal builds fail clearly when WordPress cannot be detected', async t => {
	const { root, write } = await setup(t);
	await write('package.json', { name: 'fixture-validation' });
	const cli = new URL('../index.js', import.meta.url).pathname;
	await assert.rejects(promisify(execFile)(process.execPath, [cli, '--builds=scripts'], { cwd: root, timeout: 15000 }), error => {
		assert.equal(error.code, 1);
		assert.match(error.stderr, /Cannot detect WordPress/);
		return true;
	});
});

test('clearing the cache removes schemas before the next build downloads them again', async t => {
	const { root, write } = await setup(t);
	await write('package.json', { name: 'fixture-validation' });
	await loadWordPressSchemas({ root, version: '6.8' });
	const cacheDir = path.join(root, '.sdc-build-wp/cache');
	const schemaDir = path.join(cacheDir, 'schemas');
	assert.equal((await fs.readdir(schemaDir)).length, 2);
	await write('.sdc-build-wp/cache/old-output.marker', 'cached build data');
	const cli = new URL('../index.js', import.meta.url).pathname;
	const cleared = await promisify(execFile)(process.execPath, [cli, '--clear-cache'], { cwd: root, timeout: 15000 });
	assert.match(cleared.stdout, /Cache cleared/);
	assert.doesNotMatch(cleared.stdout + cleared.stderr, /WordPress validation|Cannot detect WordPress/);
	assert.deepEqual(await fs.readdir(cacheDir), []);
	await assert.rejects(fs.stat(schemaDir), { code: 'ENOENT' });
	let downloads = 0;
	await loadWordPressSchemas({ root, version: '6.8', fetcher: async url => {
		downloads++;
		return new Response(JSON.stringify(url.endsWith('/theme.json') ? themeSchema : blockSchema));
	} });
	assert.equal(downloads, 2);
	await write('wp-includes/version.php', '<?php\n$wp_version = "6.8";');
	await write('theme.json', { version: 3 });
	await write('_src/scripts/main.js', 'export const fixture = true;');
	const built = await promisify(execFile)(process.execPath, [cli, '--builds=scripts'], { cwd: root, timeout: 15000 });
	assert.match(built.stdout, /Validated 1 file/);
	assert.equal((await fs.readdir(schemaDir)).length, 2);
	assert.ok((await fs.stat(path.join(cacheDir, 'manifest.json'))).isFile());
	assert.match(await fs.readFile(path.join(root, '.gitignore'), 'utf8'), /\.sdc-build-wp\/cache/);
});

test('schema caches are isolated between project directories', async t => {
	const { root } = await setup(t);
	const first = path.join(root, 'first');
	const second = path.join(root, 'second');
	await loadWordPressSchemas({ root: first, version: '6.8' });
	await assert.rejects(loadWordPressSchemas({ root: second, version: '6.8', fetcher: async () => { throw new Error('offline'); } }), /offline/);
	assert.ok((await fs.stat(path.join(first, '.sdc-build-wp/cache/schemas/wordpress-6.8-theme.json'))).isFile());
	await assert.rejects(fs.stat(path.join(second, '.sdc-build-wp/cache/schemas')), { code: 'ENOENT' });
});

test('proxy detection reads WordPress generator metadata but does not guess from assets', async t => {
	const { root } = await setup(t);
	t.mock.method(globalThis, 'fetch', async () => new Response('<META content="WordPress 6.7.2" name="GENERATOR"><script src="/wp-includes/main.js?ver=9.9"></script>'));
	assert.equal((await detectWordPressVersion({ root, localProxyURL: 'https://example.test/' })).version, '6.7.2');
	t.mock.method(globalThis, 'fetch', async () => new Response('<script src="/main.js?ver=6.8"></script>'));
	await assert.rejects(detectWordPressVersion({ root, localProxyURL: 'https://example.test/' }), /wordpressVersionCommand/);
	t.mock.method(globalThis, 'fetch', async () => new Response('<meta name="generator" content="WordPress 6.7"><meta name="generator" content="WordPress 6.8">'));
	await assert.rejects(detectWordPressVersion({ root, localProxyURL: 'https://example.test/' }), /conflicting WordPress/);
});

test('custom version commands run in the project directory and take precedence over HTTP', async t => {
	const { root, write } = await setup(t);
	await write('version.txt', '6.8.3\n');
	const wordpressVersionCommand = `"${process.execPath}" -e 'process.stdout.write(require("node:fs").readFileSync("version.txt"))'`;
	t.mock.method(globalThis, 'fetch', async () => { throw new Error('HTTP must not run'); });
	assert.equal((await detectWordPressVersion({ root, wordpressVersionCommand, localProxyURL: 'https://example.test/' })).version, '6.8.3');
	await write('wp-includes/version.php', '<?php\n$wp_version = "6.7.2";');
	assert.equal((await detectWordPressVersion({ root, wordpressVersionCommand })).version, '6.7.2');
});

test('custom command failures and noisy output produce actionable errors', async t => {
	const { root } = await setup(t);
	await assert.rejects(detectWordPressVersion({ root, wordpressVersionCommand: `"${process.execPath}" -e 'process.exit(2)'` }), /wordpressVersionCommand failed \(2\)/);
	await assert.rejects(detectWordPressVersion({ root, wordpressVersionCommand: `"${process.execPath}" -e 'console.log("WordPress 6.8.3")'` }), /must print only a WordPress version/);
});

test('normal builds use proxy metadata or per-project commands without local version files', async t => {
	const { root, write } = await setup(t);
	let exposeVersion = true;
	const server = createServer((request, response) => {
		response.setHeader('Content-Type', 'text/html');
		response.end(exposeVersion ? '<meta name="generator" content="WordPress 6.8.3">' : '<html><body>No version metadata</body></html>');
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	t.after(() => new Promise(resolve => server.close(resolve)));
	const localProxyURL = `http://127.0.0.1:${server.address().port}/`;
	await write('package.json', { name: 'fixture-proxy-detection' });
	await write('theme.json', { version: 3 });
	await write('.sdc-build-wp/config.json', { browsersync: { localProxyURL } });
	await loadWordPressSchemas({ root, version: '6.8' });
	const cli = new URL('../index.js', import.meta.url).pathname;
	const build = () => promisify(execFile)(process.execPath, [cli, '--builds=scripts', '--no-cache'], { cwd: root, timeout: 15000 });
	const proxyBuild = await build();
	assert.match(proxyBuild.stdout, /Validated 1 file/);
	assert.doesNotMatch(proxyBuild.stdout, /localProxyURL generator metadata/);
	exposeVersion = false;
	await assert.rejects(build(), error => {
		assert.equal(error.code, 1);
		assert.match(error.stderr, /wordpressVersionCommand/);
		return true;
	});
	await write('version.txt', '6.8.3');
	await write('.sdc-build-wp/config.json', {
		browsersync: { localProxyURL },
		wordpressVersionCommand: `"${process.execPath}" -e 'process.stdout.write(require("node:fs").readFileSync("version.txt"))'`
	});
	const commandBuild = await build();
	assert.doesNotMatch(commandBuild.stdout, /configured wordpressVersionCommand/);
	assert.match(commandBuild.stdout, /Validated 1 file/);
});

test('version command configuration requires a nonempty string', () => {
	const validate = new Ajv().compile(configSchema);
	assert.equal(validate({ wordpressVersionCommand: 'wp core version' }), true);
	for (const wordpressVersionCommand of ['', '  ', 42, false, []]) {
		assert.equal(validate({ wordpressVersionCommand }), false);
	}
});

test('unreadable local version files permit command fallback and HTTP errors are actionable', async t => {
	const { root } = await setup(t);
	const readFile = fs.readFile;
	t.mock.method(fs, 'readFile', async (file, ...options) => {
		if (String(file).endsWith('wp-includes/version.php')) {
			const error = new Error('permission denied');
			error.code = 'EACCES';
			throw error;
		}
		return readFile(file, ...options);
	});
	const command = `"${process.execPath}" -e 'console.log("6.8.3")'`;
	assert.equal((await detectWordPressVersion({ root, wordpressVersionCommand: command })).version, '6.8.3');
	t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }));
	await assert.rejects(detectWordPressVersion({ root, localProxyURL: 'http://example.test/' }), /Proxy returned HTTP 503/);
	t.mock.method(globalThis, 'fetch', async () => { throw new Error('certificate not trusted'); });
	await assert.rejects(detectWordPressVersion({ root, localProxyURL: 'https://example.test/' }), /certificate not trusted.*wordpressVersionCommand/);
});

test('targeted validation reads only the saved file and keeps duplicate checks without repeated detection logs', async t => {
	const { root, write, validate } = await setup(t);
	await write('theme.json', { version: 3 });
	await write('blocks/first/src/block.json', { name: 'fixture/first', title: 'First' });
	await write('blocks/second/src/block.json', { name: 'fixture/second', title: 'Second' });
	const initial = await validate();
	await write('blocks/second/src/block.json', { name: 'fixture/first', title: 'Second' });
	const originalRead = fs.readFile;
	const reads = [];
	t.mock.method(fs, 'readFile', async (file, ...options) => {
		reads.push(file);
		return originalRead(file, ...options);
	});
	const file = path.join(root, 'blocks/second/src/block.json');
	const result = await validateWordPress({ root, file, context: initial.context });
	assert.deepEqual(reads, [file]);
	assert.deepEqual(result.files, ['blocks/second/src/block.json']);
	assert.ok(result.diagnostics.some(item => item.pointer === '/name' && /Duplicate/.test(item.message)));
	const logs = [];
	logValidation(result, (type, message) => logs.push({ type, message }), { singleFile: true });
	assert.equal(logs.some(item => /using .* schemas/.test(item.message)), false);
	assert.ok(logs.some(item => /^Failed validating \/blocks\/second\/src\/block.json in \d+ms - see above error\.$/.test(item.message)));
	assert.equal(initial.context.blockNames.size, 2);
});

test('validation summary severity reflects the highest diagnostic severity', () => {
	for (const [severities, expected, message] of [
		[[], 'success', 'Validated 2 files in 12ms'],
		[['warn'], 'warn', 'Validated 2 files with 1 warning in 12ms'],
		[['warn', 'warn'], 'warn', 'Validated 2 files with 2 warnings in 12ms'],
		[['error'], 'error', 'Validated 1 file; failed validating 1 file in 12ms - see above error.'],
		[['warn', 'error'], 'error', 'Validated 1 file; failed validating 1 file in 12ms - see above error.']
	]) {
		const logs = [];
		const diagnostics = severities.map(severity => ({ severity, file: 'theme.json', pointer: '/version', message: 'Diagnostic' }));
		const errors = logValidation({ files: ['theme.json', 'styles/card.json'], diagnostics, elapsedMs: 12 }, (type, message) => logs.push({ type, message }));
		assert.deepEqual(logs.at(-1), { type: expected, message });
		assert.equal(errors, severities.filter(severity => severity === 'error').length);
	}
});

test('single-file save logs use the validated convention and omit empty issue counts', () => {
	for (const [severities, expected, severity] of [
		[[], 'Validated /styles/card.json in 12ms', 'success'],
		[['warn'], 'Validated /styles/card.json with 1 warning in 12ms', 'warn'],
		[['warn', 'warn'], 'Validated /styles/card.json with 2 warnings in 12ms', 'warn'],
		[['error'], 'Failed validating /styles/card.json in 12ms - see above error.', 'error'],
		[['error', 'error'], 'Failed validating /styles/card.json in 12ms - see above error.', 'error'],
		[['error', 'warn'], 'Failed validating /styles/card.json in 12ms - see above error.', 'error']
	]) {
		const logs = [];
		const diagnostics = severities.map(severity => ({ severity, file: 'styles/card.json', pointer: '/', message: 'Diagnostic' }));
		logValidation({ files: ['styles/card.json'], diagnostics, elapsedMs: 12 }, (type, message) => logs.push({ type, message }), { singleFile: true });
		assert.deepEqual(logs.at(-1), { type: severity, message: expected });
	}
});

test('startup summaries count failed files rather than individual errors', () => {
	for (const [errorFiles, expected] of [
		[['theme.json', 'theme.json'], 'Validated 2 files; failed validating 1 file in 12ms - see above error.'],
		[['theme.json', 'styles/first.json'], 'Validated 1 file; failed validating 2 files in 12ms - see above error.'],
		[['theme.json', 'styles/first.json', 'styles/second.json'], 'Failed validating 3 files in 12ms - see above error.']
	]) {
		const logs = [];
		const files = ['theme.json', 'styles/first.json', 'styles/second.json'];
		const diagnostics = errorFiles.map(file => ({ severity: 'error', file, pointer: '/', message: 'Diagnostic' }));
		const errors = logValidation({ files, diagnostics, elapsedMs: 12 }, (type, message) => logs.push({ type, message }));
		assert.deepEqual(logs.at(-1), { type: 'error', message: expected });
		assert.equal(errors, diagnostics.length);
	}
});

test('unchanged saves reuse validation results but changed contents and references invalidate them', async t => {
	const { root, write, validate } = await setup(t);
	await write('blocks/example/src/block.json', { name: 'fixture/example', title: 'Example', render: 'file:./render.php' });
	const initial = await validate();
	const options = { root, file: 'blocks/example/src/block.json', context: initial.context };
	const cached = await validateWordPress(options);
	assert.equal(cached.cachedFiles, 1);
	assert.ok(cached.diagnostics.some(diagnostic => /render.php/.test(diagnostic.message)));
	assert.ok(cached.elapsedMs >= 0);
	await write('blocks/example/src/render.php', '<?php');
	const repaired = await validateWordPress(options);
	assert.equal(repaired.cachedFiles, 0);
	assert.equal(repaired.diagnostics.length, 0);
	assert.equal((await validateWordPress(options)).cachedFiles, 1);
	await write('blocks/example/src/block.json', '{');
	const invalid = await validateWordPress(options);
	assert.equal(invalid.cachedFiles, 0);
	assert.ok(invalid.diagnostics.some(diagnostic => /Cannot read JSON/.test(diagnostic.message)));
	assert.equal((await validateWordPress(options)).cachedFiles, 1);
});

test('cache hits skip schema validation while disabled caching and changed schemas rerun it', async t => {
	const { root, write, validate } = await setup(t);
	await write('theme.json', { version: 3 });
	const initial = await validate();
	const options = { root, file: 'theme.json', context: initial.context };
	const original = initial.context.schemas.theme;
	let calls = 0;
	initial.context.schemas.theme = data => {
		calls++;
		return original(data);
	};
	assert.equal((await validateWordPress(options)).cachedFiles, 0);
	assert.equal(calls, 1);
	assert.equal((await validateWordPress(options)).cachedFiles, 1);
	assert.equal(calls, 1);
	assert.equal((await validateWordPress({ ...options, useCache: false })).cachedFiles, 0);
	assert.equal(calls, 2);
	assert.equal((await validateWordPress(options)).cachedFiles, 0);
	assert.equal(calls, 3);
});

test('cached warnings and duplicate block diagnostics remain current', async t => {
	const { root, write, validate } = await setup(t);
	await write('theme.json', { version: 3, templateParts: [{ name: 'header', title: 'Header' }] });
	await write('blocks/first/src/block.json', { name: 'fixture/first', title: 'First' });
	await write('blocks/second/src/block.json', { name: 'fixture/second', title: 'Second' });
	const initial = await validate();
	const options = { root, context: initial.context };
	const cachedTheme = await validateWordPress({ ...options, file: 'theme.json' });
	assert.equal(cachedTheme.cachedFiles, 1);
	assert.ok(cachedTheme.diagnostics.some(diagnostic => diagnostic.severity === 'warn'));
	await write('parts/header.html', '<header></header>');
	const fixedTheme = await validateWordPress({ ...options, file: 'theme.json' });
	assert.equal(fixedTheme.cachedFiles, 0);
	assert.equal(fixedTheme.diagnostics.length, 0);
	await write('blocks/second/src/block.json', { name: 'fixture/first', title: 'Second' });
	await validateWordPress({ ...options, file: 'blocks/second/src/block.json' });
	const duplicate = await validateWordPress({ ...options, file: 'blocks/first/src/block.json' });
	assert.equal(duplicate.cachedFiles, 1);
	assert.ok(duplicate.diagnostics.some(diagnostic => /Duplicate block name/.test(diagnostic.message)));
	await write('blocks/second/src/block.json', { name: 'fixture/second', title: 'Second' });
	await validateWordPress({ ...options, file: 'blocks/second/src/block.json' });
	assert.equal((await validateWordPress({ ...options, file: 'blocks/first/src/block.json' })).diagnostics.length, 0);
});

test('cache and timing markers preserve success warning and error log conventions', () => {
	for (const [severity, expected] of [
		['success', 'Validated /theme.json (cached) in 12ms'],
		['warn', 'Validated /theme.json with 1 warning (cached) in 12ms'],
		['error', 'Failed validating /theme.json (cached) in 12ms - see above error.']
	]) {
		const diagnostics = severity === 'success' ? [] : [{ severity, file: 'theme.json', pointer: '/', message: 'Diagnostic' }];
		const logs = [];
		logValidation({ files: ['theme.json'], diagnostics, cachedFiles: 1, elapsedMs: 12.2 }, (type, message) => logs.push({ type, message }), { singleFile: true });
		assert.deepEqual(logs.at(-1), { type: severity, message: expected });
	}
	const logs = [];
	logValidation({ files: ['theme.json', 'styles/card.json'], diagnostics: [], cachedFiles: 1, elapsedMs: 12 }, (type, message) => logs.push({ type, message }));
	assert.deepEqual(logs.at(-1), { type: 'success', message: 'Validated 2 files (1 cached) in 12ms' });
});

test('filesystem inspection failures become per-file diagnostics and other metadata still validates', async t => {
	const { root, write, validate } = await setup(t);
	await write('theme.json', { version: 3, templateParts: [{ name: 'header', title: 'Header' }] });
	await write('styles/card.json', { title: 'Card' });
	const originalStat = fs.stat;
	t.mock.method(fs, 'stat', async (file, ...options) => {
		if (String(file).endsWith('parts/header.html')) {
			const error = new Error('permission denied');
			error.code = 'EACCES';
			throw error;
		}
		return originalStat(file, ...options);
	});
	const result = await validate();
	assert.deepEqual(result.files, ['theme.json', 'styles/card.json']);
	assert.ok(result.diagnostics.some(diagnostic => diagnostic.file === 'theme.json' && /permission denied/.test(diagnostic.message)));
	assert.equal(result.context.validationCache.has(path.join(root, 'theme.json')), false);
	assert.equal(result.context.validationCache.has(path.join(root, 'styles/card.json')), true);
});

test('version detection failures say validation could not start instead of reporting zero failed files', async t => {
	const { root } = await setup(t);
	const result = await validateWordPress({ root });
	assert.equal(result.setupFailed, true);
	const logs = [];
	logValidation(result, (type, message) => logs.push({ type, message }));
	assert.equal(logs.at(-1).type, 'error');
	assert.match(logs.at(-1).message, /^Failed starting validation in \d+ms - see above error\.$/);
	assert.doesNotMatch(logs.at(-1).message, /0 files/);
});

test('asset changes revalidate only owning metadata and paused deletions update the block index', async t => {
	const { root, write, validate } = await setup(t);
	await write('theme.json', { version: 3 });
	await write('blocks/first/src/block.json', { name: 'fixture/first', title: 'First', render: 'file:./render.php' });
	await write('blocks/second/src/block.json', { name: 'fixture/second', title: 'Second' });
	const initial = await validate();
	const emitter = new EventEmitter();
	emitter.add = () => {};
	emitter.close = async () => {};
	t.mock.method(chokidar, 'watch', () => emitter);
	const logs = [];
	let running = true;
	const watcher = watchWordPressValidation({ root, context: initial.context, isRunning: () => running }, (type, message) => logs.push({ type, message }));
	t.after(() => watcher.stopWatching());
	const waitFor = async predicate => {
		const deadline = Date.now() + 3000;
		while (!predicate()) {
			assert.ok(Date.now() < deadline, JSON.stringify(logs));
			await new Promise(resolve => setTimeout(resolve, 10));
		}
	};
	await write('blocks/first/src/render.php', '<?php');
	emitter.emit('all', 'add', path.join(root, 'blocks/first/src/render.php'));
	await waitFor(() => logs.some(entry => /^Validated \/blocks\/first\/src\/block.json/.test(entry.message)));
	assert.equal(logs.some(entry => /theme.json|second\/src/.test(entry.message)), false);
	running = false;
	const first = path.join(root, 'blocks/first/src/block.json');
	await fs.rm(first);
	emitter.emit('all', 'unlink', first);
	await waitFor(() => !initial.context.blockNames.has(first));
	assert.equal(initial.context.validationCache.has(first), false);
	await write('blocks/second/src/block.json', { name: 'fixture/first', title: 'Second' });
	emitter.emit('all', 'change', path.join(root, 'blocks/second/src/block.json'));
	await new Promise(resolve => setTimeout(resolve, 150));
	running = true;
	await watcher.resume();
	assert.ok(logs.some(entry => /^Validated \/blocks\/second\/src\/block.json/.test(entry.message)));
	assert.equal(logs.some(entry => /Duplicate block name/.test(entry.message)), false);
});

test('failed schema loading waits for the other download and its cache write to finish', async t => {
	const { root } = await setup(t);
	let releaseBlock;
	const blockGate = new Promise(resolve => { releaseBlock = resolve; });
	t.after(() => releaseBlock());
	let themeFailed = false;
	let settled = false;
	const observed = loadWordPressSchemas({ root, version: '6.8', fetcher: async url => {
		if (url.endsWith('/theme.json')) {
			themeFailed = true;
			return new Response('', { status: 404 });
		}
		await blockGate;
		return new Response(JSON.stringify(blockSchema));
	} }).then(() => { throw new Error('Expected the theme schema to fail'); }, error => {
		settled = true;
		return error;
	});
	const deadline = Date.now() + 3000;
	while (!themeFailed) {
		assert.ok(Date.now() < deadline);
		await new Promise(resolve => setTimeout(resolve, 10));
	}
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(settled, false);
	releaseBlock();
	assert.match((await observed).message, /HTTP 404/);
	const cache = path.join(root, '.sdc-build-wp/cache');
	assert.deepEqual(await fs.readdir(path.join(cache, 'schemas')), ['wordpress-6.8-block.json']);
	await fs.rm(cache, { recursive: true });
	await new Promise(resolve => setImmediate(resolve));
	await assert.rejects(fs.stat(cache), { code: 'ENOENT' });
});
