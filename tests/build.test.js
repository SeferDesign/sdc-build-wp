import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';

const execFileAsync = promisify(execFile);
const cli = fileURLToPath(new URL('../index.js', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/theme/', import.meta.url));

async function copyFixture(root, options = {}) {
	await fs.cp(fixture, root, { recursive: true, ...options });
	await fs.mkdir(path.join(root, 'wp-includes'), { recursive: true });
	await fs.writeFile(path.join(root, 'wp-includes/version.php'), '<?php\n$wp_version = "6.8";');
	const schemaCacheDir = path.join(root, '.sdc-build-wp/cache/schemas');
	await fs.mkdir(schemaCacheDir, { recursive: true });
	await fs.writeFile(path.join(schemaCacheDir, 'wordpress-6.8-theme.json'), JSON.stringify({ type: 'object', required: ['version'], properties: { version: { type: 'integer' } } }));
	await fs.writeFile(path.join(schemaCacheDir, 'wordpress-6.8-block.json'), JSON.stringify({ type: 'object', required: ['name', 'title'], properties: { name: { type: 'string' }, title: { type: 'string' } } }));
}

test('CLI exits nonzero when a component logs a build failure', async t => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-failure-'));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	await copyFixture(root);
	await fs.writeFile(path.join(root, '_src/style/main.scss'), '.broken { color: $missing; }');
	await assert.rejects(execFileAsync(process.execPath, [cli, '--builds=style', '--no-cache'], {
		cwd: root, timeout: 30000
	}), error => {
		assert.equal(error.code, 1);
		assert.match(error.stdout + error.stderr, /Build failed/);
		return true;
	});
});

test('watch mode discovers entries and dependencies and rebuilds without the server component', { timeout: 30000 }, async t => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-watch-'));
	await copyFixture(root);
	const configPath = path.join(root, '.sdc-build-wp/config.json');
	const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
	delete config.entries;
	await fs.writeFile(configPath, JSON.stringify(config));
	const child = spawn(process.execPath, [cli, '--builds=style,scripts', '--watch'], {
		cwd: root,
		stdio: ['pipe', 'pipe', 'pipe'],
		env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }
	});
	let output = '';
	child.stdout.on('data', chunk => { output += chunk; });
	child.stderr.on('data', chunk => { output += chunk; });
	const exited = new Promise((resolve, reject) => {
		child.once('error', reject);
		child.once('exit', (code, signal) => resolve({ code, signal }));
	});
	t.after(async () => {
		if (child.exitCode === null && child.signalCode === null) {
			child.kill('SIGKILL');
		}
		await exited;
		await fs.rm(root, { recursive: true, force: true });
	});
	const waitFor = async predicate => {
		const deadline = Date.now() + 15000;
		while (!(await predicate())) {
			assert.equal(child.exitCode, null, output);
			assert.equal(child.signalCode, null, output);
			assert.ok(Date.now() < deadline, output);
			await new Promise(resolve => setTimeout(resolve, 25));
		}
	};
	await waitFor(() => output.includes('Started watching [cache, style, scripts]'));
	const validationStart = output.indexOf('Validated 1 file');
	assert.ok(validationStart > output.indexOf('Started initial build'), output);
	assert.doesNotMatch(output, /using 6\.8 schemas/);
	// Chokidar's initial scan must finish before changing a dependency.
	await new Promise(resolve => setTimeout(resolve, 300));
	const beforeChange = output.length;
	await fs.writeFile(path.join(root, '_src/scripts/message.js'), 'export const message = \'watch-updated\';\n');
	await waitFor(() => output.slice(beforeChange).includes('Built /dist/scripts/main.min.js'));
	const bundle = await fs.readFile(path.join(root, 'dist/scripts/main.min.js'), 'utf8');
	assert.equal(runInNewContext(`${bundle}; sdcBuild.getMessage()`), 'watch-updated');
	const contains = async (file, text) => {
		try {
			return (await fs.readFile(path.join(root, file), 'utf8')).includes(text);
		} catch (error) {
			if (error.code === 'ENOENT') { return false; }
			throw error;
		}
	};
	await fs.writeFile(path.join(root, '_src/scripts/extra.js'), 'export const extra = \'watch-extra\';\n');
	await fs.writeFile(path.join(root, '_src/style/extra.scss'), '.watch-extra { color: #abcdef; }\n');
	await waitFor(() => contains('dist/scripts/extra.min.js', 'watch-extra'));
	await waitFor(() => contains('dist/style/extra.min.css', '.watch-extra{color:#abcdef}'));

	await fs.mkdir(path.join(root, '_src/scripts/nested'));
	const dependency = path.join(root, '_src/scripts/nested/new.js');
	await fs.writeFile(dependency, 'export const message = \'new-dependency\';\n');
	await fs.writeFile(path.join(root, '_src/scripts/main.js'),
		'import { message } from \'./nested/new.js\';\nexport function getMessage() { return message; }\n');
	await waitFor(() => contains('dist/scripts/main.min.js', 'new-dependency'));
	await fs.writeFile(dependency, 'export const message = \'dependency-updated\';\n');
	await waitFor(() => contains('dist/scripts/main.min.js', 'dependency-updated'));
	const updatedBundle = await fs.readFile(path.join(root, 'dist/scripts/main.min.js'), 'utf8');
	assert.equal(runInNewContext(`${updatedBundle}; sdcBuild.getMessage()`), 'dependency-updated');
	await assert.rejects(fs.access(path.join(root, 'dist/scripts/nested/new.min.js')), { code: 'ENOENT' });
	assert.doesNotMatch(output, /Failed|Uncaught|Unhandled|✖/);
	const lastGoodBundle = await fs.readFile(path.join(root, 'dist/scripts/main.min.js'), 'utf8');
	const beforeFailure = output.length;
	await fs.writeFile(path.join(root, '_src/scripts/main.js'), 'import "./missing-module.js";');
	await waitFor(() => output.slice(beforeFailure).includes('Failed building'));
	assert.equal(child.exitCode, null, output);
	assert.equal(await fs.readFile(path.join(root, 'dist/scripts/main.min.js'), 'utf8'), lastGoodBundle);
	await new Promise(resolve => setTimeout(resolve, 100));
	await fs.writeFile(path.join(root, '_src/scripts/main.js'), 'export const recovered = "watch-recovered";');
	await waitFor(() => contains('dist/scripts/main.min.js', 'watch-recovered'));
	const themePath = path.join(root, 'theme.json');
	const theme = JSON.parse(await fs.readFile(themePath, 'utf8'));
	const beforeInvalidMetadata = output.length;
	await fs.writeFile(themePath, JSON.stringify({ ...theme, version: 'invalid' }));
	await waitFor(() => output.slice(beforeInvalidMetadata).includes('theme.json (/version)'));
	assert.equal(child.exitCode, null, output);
	const beforeMetadataRecovery = output.length;
	await fs.writeFile(themePath, JSON.stringify(theme));
	await waitFor(() => /Validated \/theme.json in \d+ms/.test(output.slice(beforeMetadataRecovery)));
	assert.match(output.slice(beforeMetadataRecovery), /Validated \/theme.json/);
	assert.doesNotMatch(output.slice(beforeInvalidMetadata), /using 6\.8 schemas/);
	const beforeUnchangedSave = output.length;
	await fs.writeFile(themePath, JSON.stringify(theme));
	await waitFor(() => /Validated \/theme.json \(cached\) in \d+ms/.test(output.slice(beforeUnchangedSave)));
	await fs.mkdir(path.join(root, 'styles'), { recursive: true });
	const beforeMetadataBurst = output.length;
	await Promise.all(['first', 'second'].map(name => fs.writeFile(path.join(root, `styles/${name}.json`), JSON.stringify({ version: 'invalid' }))));
	await waitFor(() => output.slice(beforeMetadataBurst).includes('styles/first.json (/version)') && output.slice(beforeMetadataBurst).includes('styles/second.json (/version)'));
	await waitFor(() => (output.slice(beforeMetadataBurst).match(/Failed validating \/styles\/\w+.json in \d+ms - see above error\./g) || []).length >= 2);
	assert.doesNotMatch(output.slice(beforeMetadataBurst), /using 6\.8 schemas|theme.json \(\/version\)/);
	const withReference = {
		...theme,
		settings: { ...theme.settings, custom: { ...theme.settings?.custom, validationAsset: 'file:./validation-assets/font.woff2' } }
	};
	const beforeReference = output.length;
	await fs.writeFile(themePath, JSON.stringify(withReference));
	await waitFor(() => /Failed validating \/theme.json/.test(output.slice(beforeReference)));
	await fs.mkdir(path.join(root, 'validation-assets'));
	const asset = path.join(root, 'validation-assets/font.woff2');
	const beforeAssetCreation = output.length;
	await fs.writeFile(asset, 'fixture font');
	await waitFor(() => /Validated \/theme.json in \d+ms/.test(output.slice(beforeAssetCreation)));
	assert.doesNotMatch(output.slice(beforeAssetCreation), /styles\/first.json|styles\/second.json/);
	const beforeAssetRemoval = output.length;
	await fs.rm(asset);
	await waitFor(() => /Failed validating \/theme.json/.test(output.slice(beforeAssetRemoval)));
	child.kill('SIGINT');
	await waitFor(() => child.exitCode !== null);
	assert.deepEqual(await exited, { code: 0, signal: null });
});

test('test theme builds through the CLI, reuses cache, and rebuilds changed or missing outputs', { timeout: 120000 }, async t => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-theme-'));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	await copyFixture(root, {
		recursive: true,
		filter: source => ![
			'dist',
			path.join('.sdc-build-wp', 'cache'),
			path.join('_src', 'style', 'partials', '_theme.scss')
		].includes(path.relative(fixture, source))
	});
	const build = async (...args) => {
		const { stdout, stderr } = await execFileAsync(process.execPath, [cli, '--builds=style,scripts,images', ...args], {
			cwd: root,
			timeout: 30000,
			maxBuffer: 4 * 1024 * 1024,
			env: { ...process.env, NODE_ENV: 'development', NO_COLOR: '1', FORCE_COLOR: '0' }
		});
		assert.doesNotMatch(stdout + stderr, /Failed|Continuing without failed components|Uncaught|Unhandled|✖/, stdout + stderr);
		assert.match(stdout, /Finished initial build/);
		return stdout;
	};
	const cssPath = path.join(root, 'dist/style/main.min.css');
	const scriptPath = path.join(root, 'dist/scripts/main.min.js');
	const read = relative => fs.readFile(path.join(root, relative), 'utf8');
	const bundleMessage = async () => runInNewContext(`${await read('dist/scripts/main.min.js')}; sdcBuild.getMessage()`);

	await build();
	assert.match(await read('dist/style/main.min.css'), /\.fixture\{color:#123456;display:flex\}/);
	assert.equal(await bundleMessage(), 'fixture-original');
	assert.equal(JSON.parse(await read('dist/scripts/main.min.js.map')).version, 3);
	assert.equal(JSON.parse(await read('dist/style/main.min.css.map')).version, 3);
	assert.match(await read('_src/style/partials/_theme.scss'), /\$brand: #123456/);
	assert.match(await read('dist/images/icon.svg'), /<svg/);
	const manifest = JSON.parse(await read('.sdc-build-wp/cache/manifest.json'));
	assert.equal(Object.keys(manifest.entries).length, 2);
	for (const entry of Object.values(manifest.entries)) {
		assert.ok(Object.keys(entry.dependencies).length > 0);
	}
	const initialCSS = await fs.stat(cssPath);
	const initialScript = await fs.stat(scriptPath);

	const warmOutput = await build();
	assert.match(warmOutput, /main\.min\.css \(cached\)/);
	assert.match(warmOutput, /main\.min\.js \(cached\)/);
	assert.equal((await fs.stat(cssPath)).mtimeMs, initialCSS.mtimeMs);
	assert.equal((await fs.stat(scriptPath)).mtimeMs, initialScript.mtimeMs);

	await fs.writeFile(path.join(root, '_src/style/partials/_tokens.scss'), '$accent: #654321;\n');
	await fs.writeFile(path.join(root, '_src/scripts/message.js'), 'export const message = \'fixture-updated\';\n');
	const updatedOutput = await build();
	assert.doesNotMatch(updatedOutput, /main\.min\.(css|js) \(cached\)/);
	assert.match(await read('dist/style/main.min.css'), /color:#654321/);
	assert.equal(await bundleMessage(), 'fixture-updated');

	await fs.rm(cssPath);
	await fs.rm(scriptPath);
	const missingOutput = await build();
	assert.doesNotMatch(missingOutput, /main\.min\.(css|js) \(cached\)/);
	assert.match(await read('dist/style/main.min.css'), /color:#654321/);
	assert.equal(await bundleMessage(), 'fixture-updated');

	const uncachedOutput = await build('--no-cache');
	assert.doesNotMatch(uncachedOutput, /\(cached\)/);
	assert.equal(await bundleMessage(), 'fixture-updated');
});

test('CLI rejects invalid input and failed writes without reporting success', async t => {
	for (const scenario of [
		{ name: 'unresolved import', builds: 'scripts', prepare: root => fs.writeFile(path.join(root, '_src/scripts/main.js'), 'import "./absent.js";'), pattern: /Failed building/ },
		{ name: 'invalid config', builds: 'scripts', prepare: root => fs.writeFile(path.join(root, '.sdc-build-wp/config.json'), '{"buildConcurrency":{"total":0}}'), pattern: /Configuration validation failed/ },
		{ name: 'malformed JSON', builds: 'scripts', prepare: root => fs.writeFile(path.join(root, '.sdc-build-wp/config.json'), '{'), pattern: /Failed to load config/ },
		{ name: 'unknown component', builds: 'scritps', prepare: async () => {}, pattern: /Unknown build components/ },
		{ name: 'failed output write', builds: 'scripts', prepare: async root => {
			const output = path.join(root, 'dist/scripts/main.min.js');
			await fs.rm(output, { recursive: true, force: true });
			await fs.mkdir(output, { recursive: true });
		}, pattern: /Failed building/ }
	]) {
		await t.test(scenario.name, async t => {
			const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-cli-error-'));
			t.after(() => fs.rm(root, { recursive: true, force: true }));
			await copyFixture(root);
			await scenario.prepare(root);
			await assert.rejects(execFileAsync(process.execPath, [cli, `--builds=${scenario.builds}`, '--no-cache'], {
				cwd: root, timeout: 30000
			}), error => {
				assert.equal(error.code, 1);
				assert.match(error.stdout + error.stderr, scenario.pattern);
				assert.doesNotMatch(error.stdout, /Finished initial build/);
				return true;
			});
		});
	}
});

test('CLI compiles a real WordPress block with metadata and dependency output', { timeout: 60000 }, async t => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-cli-block-'));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	await copyFixture(root);
	await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture-theme', private: true, browserslist: ['defaults'] }));
	const source = path.join(root, 'blocks/example/src');
	await fs.mkdir(source, { recursive: true });
	await fs.writeFile(path.join(source, 'block.json'), JSON.stringify({ apiVersion: 3, name: 'fixture/example', title: 'Example', category: 'widgets', editorScript: 'file:./index.js' }));
	await fs.writeFile(path.join(source, 'index.js'), 'window.fixtureBlock = "compiled-block";');
	const { stdout, stderr } = await execFileAsync(process.execPath, [cli, '--builds=blocks', '--no-cache'], { cwd: root, timeout: 45000 });
	assert.doesNotMatch(stdout + stderr, /Failed|Uncaught|Unhandled/);
	const output = path.join(root, 'blocks/example/build');
	assert.match(await fs.readFile(path.join(output, 'index.js'), 'utf8'), /compiled-block/);
	assert.match(await fs.readFile(path.join(output, 'index.asset.php'), 'utf8'), /dependencies/);
	assert.equal(JSON.parse(await fs.readFile(path.join(output, 'block.json'), 'utf8')).name, 'fixture/example');
});
