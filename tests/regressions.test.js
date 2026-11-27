import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import project from '../lib/project.js';
import * as utils from '../lib/utils.js';
import FontsComponent from '../lib/components/fonts.js';
import ImagesComponent from '../lib/components/images.js';
import ErrorsComponent from '../lib/components/errors.js';
import ServerComponent from '../lib/components/server.js';
import BlocksComponent from '../lib/components/blocks.js';
import PHPComponent from '../lib/components/php.js';
import { makeTheme, run, withProject } from './helpers/index.js';

const execFileAsync = promisify(execFile);

test('Sass dependencies include nested partials, forwards, comma lists and index files', async t => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-sass-deps-'));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	await fs.mkdir(path.join(root, 'lib/menu'), { recursive: true });
	await fs.writeFile(path.join(root, 'main.scss'), '// @use "commented";\n@use "lib/a";\n@import "x", "y";\n');
	await fs.writeFile(path.join(root, 'lib/_a.scss'), '@forward "menu";\n@use "sass:math";');
	await fs.writeFile(path.join(root, 'lib/menu/_index.scss'), '@use "../deep";');
	await fs.writeFile(path.join(root, 'lib/_deep.scss'), '$c: #fff;');
	const dependencies = await utils.getImportedSASSFiles(path.join(root, 'main.scss'));
	for (const expected of ['lib/_a.scss', 'lib/menu/_index.scss', 'lib/_deep.scss', 'x.scss', '_y.scss']) {
		assert.ok(dependencies.includes(path.join(root, expected)), `${expected} should be tracked`);
	}
	assert.ok(!dependencies.some(file => file.includes('commented') || file.includes('sass:')));
	assert.ok(!dependencies.includes(path.join(root, 'main.scss')));
	await assert.rejects(utils.getImportedSASSFiles(path.join(root, 'missing.scss')), { code: 'ENOENT' });
});

test('script dependencies include side-effect imports and re-exports', async t => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-js-deps-'));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	const originalPath = project.path;
	project.path = root;
	t.after(() => { project.path = originalPath; });
	await Promise.all(['side', 'star', 'named', 'multi'].map(name => fs.writeFile(path.join(root, `${name}.js`), 'export const value = 1;')));
	await fs.writeFile(path.join(root, 'entry.js'), [
		'import \'./side.js\';',
		'export * from \'./star.js\';',
		'export { value } from \'./named.js\';',
		'import {\n\ta,\n\tb\n} from \'./multi.js\';',
		'export const text = \'import "./not-a-file.js"\';'
	].join('\n'));
	const dependencies = (await utils.getImportedJSFiles(path.join(root, 'entry.js'))).map(file => path.basename(file)).sort();
	assert.deepEqual(dependencies, ['multi.js', 'named.js', 'side.js', 'star.js']);
});

test('editing a nested Sass partial rebuilds instead of reusing the cache', async t => {
	const root = await makeTheme(t);
	await fs.writeFile(path.join(root, '_src/style/partials/_b.scss'), '$c: #ff0000;\n');
	await fs.writeFile(path.join(root, '_src/style/partials/_a.scss'), '@use "b";\n.nested { color: b.$c; }\n');
	await fs.writeFile(path.join(root, '_src/style/main.scss'), '@use "partials/a";\n');
	assert.equal((await run(root, ['--builds=style'])).code, 0);
	assert.match(await fs.readFile(path.join(root, 'dist/style/main.min.css'), 'utf8'), /\.nested\{color:red\}/);
	await fs.writeFile(path.join(root, '_src/style/partials/_b.scss'), '$c: #0000ff;\n');
	const { output } = await run(root, ['--builds=style']);
	assert.doesNotMatch(output, /\(cached\)/);
	assert.match(await fs.readFile(path.join(root, 'dist/style/main.min.css'), 'utf8'), /\.nested\{color:blue\}/);
});

test('a side-effect imported script change rebuilds instead of reusing the cache', async t => {
	const root = await makeTheme(t);
	await fs.writeFile(path.join(root, '_src/scripts/effect.js'), 'globalThis.marker = "one";\n');
	await fs.writeFile(path.join(root, '_src/scripts/main.js'), 'import \'./effect.js\';\nexport * from \'./message.js\';\n');
	assert.equal((await run(root, ['--builds=scripts'])).code, 0);
	await fs.writeFile(path.join(root, '_src/scripts/effect.js'), 'globalThis.marker = "two";\n');
	assert.doesNotMatch((await run(root, ['--builds=scripts'])).output, /\(cached\)/);
	assert.match(await fs.readFile(path.join(root, 'dist/scripts/main.min.js'), 'utf8'), /"two"/);
});

test('production builds do not reuse development output and omit source maps', async t => {
	const root = await makeTheme(t);
	assert.equal((await run(root, ['--builds=style,scripts'])).code, 0);
	const css = path.join(root, 'dist/style/main.min.css');
	const map = JSON.parse(await fs.readFile(`${css}.map`, 'utf8'));
	assert.ok(map.sources.some(source => source.endsWith('.scss')), `CSS source map should reference Sass: ${map.sources}`);
	const { output } = await run(root, ['--builds=style,scripts'], { NODE_ENV: 'production' });
	assert.doesNotMatch(output, /\(cached\)/);
	assert.doesNotMatch(await fs.readFile(css, 'utf8'), /sourceMappingURL/);
	for (const file of ['dist/style/main.min.css.map', 'dist/scripts/main.min.js.map']) {
		await assert.rejects(fs.access(path.join(root, file)), { code: 'ENOENT' });
	}
});

test('theme.json without styles and with nested custom settings still generates Sass tokens', async t => {
	const root = await makeTheme(t);
	const themePath = path.join(root, 'theme.json');
	const theme = JSON.parse(await fs.readFile(themePath, 'utf8'));
	delete theme.styles;
	theme.settings.custom = { spacing: { small: '1rem', largeGap: '2rem' }, dirDist: 'dist' };
	await fs.writeFile(themePath, JSON.stringify(theme));
	const { code, output } = await run(root, ['--builds=style']);
	assert.equal(code, 0, output);
	const tokens = await fs.readFile(path.join(root, '_src/style/partials/_theme.scss'), 'utf8');
	assert.match(tokens, /\$spacing-small: "1rem"; \/\/ --wp--custom--spacing--small/);
	assert.match(tokens, /\$spacing-largeGap: "2rem"; \/\/ --wp--custom--spacing--large-gap/);
	assert.match(tokens, /\$themeDirDist: "dist"/);
	assert.doesNotMatch(tokens, /object Object/);
});

test('Sass partials at the top of the style directory are not built as entries', async t => {
	const root = await makeTheme(t);
	const config = path.join(root, '.sdc-build-wp/config.json');
	await fs.writeFile(config, JSON.stringify({ php: { enabled: false } }));
	await fs.writeFile(path.join(root, '_src/style/_shared.scss'), '.shared { color: $undefined-variable; }\n');
	const { code, output } = await run(root, ['--builds=style']);
	assert.equal(code, 0, output);
	await assert.rejects(fs.access(path.join(root, 'dist/style/_shared.min.css')), { code: 'ENOENT' });
});

test('version, help and doctor commands work outside a project directory', async t => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-no-project-'));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	const { code, output } = await run(root, ['--version']);
	assert.equal(code, 0, output);
	assert.match(output, /^\d+\.\d+\.\d+/m);
	assert.doesNotMatch(output, /ENOENT|No config file/);
});

test('a project without fonts or images directories still builds successfully', async t => {
	const root = await makeTheme(t);
	await fs.rm(path.join(root, '_src/images'), { recursive: true });
	const { code, output } = await run(root, ['--builds=fonts,images']);
	assert.equal(code, 0, output);
	assert.match(output, /Skipping font copy/);
	assert.match(output, /Skipping image processing/);
});

test('imagesPath outside the source directory never overwrites the source files', async t => {
	const root = await makeTheme(t);
	await fs.mkdir(path.join(root, 'assets'));
	const original = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><!-- keep --><rect width="1" height="1"/></svg>\n';
	await fs.writeFile(path.join(root, 'assets/a.svg'), original);
	await fs.writeFile(path.join(root, '.sdc-build-wp/config.json'), JSON.stringify({ imagesPath: 'assets', php: { enabled: false } }));
	const { code, output } = await run(root, ['--builds=images']);
	assert.equal(code, 0, output);
	assert.equal(await fs.readFile(path.join(root, 'assets/a.svg'), 'utf8'), original);
	assert.doesNotMatch(await fs.readFile(path.join(root, 'dist/images/a.svg'), 'utf8'), /keep/);
});

test('image output paths outside the source root are rejected', async t => {
	const root = await withProject(t);
	const component = new ImagesComponent();
	assert.equal(component.getOutputPath(path.join(root, '_src/images/nested/a.png')), path.join(root, 'dist/images/nested/a.png'));
	assert.throws(() => component.getOutputPath(path.join(root, 'elsewhere/a.png')), /outside the images source/);
});

test('raster images keep their EXIF orientation and are never enlarged', async t => {
	const { default: sharp } = await import('sharp');
	const root = await withProject(t);
	const component = new ImagesComponent();
	const source = path.join(root, '_src/images/rotated.jpg');
	await fs.mkdir(path.dirname(source), { recursive: true });
	await sharp({ create: { width: 4, height: 2, channels: 3, background: '#336699' } }).jpeg({ quality: 100 }).withMetadata({ orientation: 6 }).toFile(source);
	assert.equal((await sharp(source).metadata()).orientation, 6);
	await component.buildFile(source);
	const output = await sharp(path.join(root, 'dist/images/rotated.jpg')).metadata();
	// metadata() reports stored dimensions, so apply any remaining orientation tag to get the displayed size
	const displayed = output.orientation >= 5 ? [output.height, output.width] : [output.width, output.height];
	assert.deepEqual(displayed, [2, 4]);
	assert.ok((await fs.stat(path.join(root, 'dist/images/rotated.jpg'))).size <= (await fs.stat(source)).size);
});

test('uppercase SVG extensions are optimized as SVG', async t => {
	const root = await withProject(t);
	const component = new ImagesComponent();
	const source = path.join(root, '_src/images/LOGO.SVG');
	await fs.mkdir(path.dirname(source), { recursive: true });
	await fs.writeFile(source, '<svg xmlns="http://www.w3.org/2000/svg"><!-- drop --><rect width="1" height="1"/></svg>');
	await component.buildFile(source);
	assert.doesNotMatch(await fs.readFile(path.join(root, 'dist/images/LOGO.SVG'), 'utf8'), /drop/);
});

test('font copies drop files removed from the source and skip .DS_Store', async t => {
	const root = await withProject(t);
	const component = new FontsComponent();
	component.log = () => {};
	const source = path.join(root, '_src/fonts');
	await fs.mkdir(path.join(source, 'nested'), { recursive: true });
	await fs.writeFile(path.join(source, 'keep.woff2'), 'a');
	await fs.writeFile(path.join(source, 'nested/gone.woff2'), 'b');
	await fs.writeFile(path.join(source, '.DS_Store'), 'junk');
	await component.init();
	await fs.access(path.join(root, 'dist/fonts/nested/gone.woff2'));
	await assert.rejects(fs.access(path.join(root, 'dist/fonts/.DS_Store')), { code: 'ENOENT' });
	await fs.rm(path.join(source, 'nested/gone.woff2'));
	await component.process();
	await fs.access(path.join(root, 'dist/fonts/keep.woff2'));
	await assert.rejects(fs.access(path.join(root, 'dist/fonts/nested/gone.woff2')), { code: 'ENOENT' });
});

test('a BrowserSync startup error is logged instead of crashing the build', async t => {
	await withProject(t, { config: {} });
	const component = new ServerComponent();
	const logs = [];
	component.log = (type, message) => logs.push({ type, message });
	component.server = { init: (options, callback) => callback(new Error('port in use'), undefined) };
	component.serve();
	assert.ok(logs.some(entry => entry.type === 'error' && /port in use/.test(entry.message)));
	assert.doesNotThrow(() => component.logURLs());
});

test('error log tailing registers a stoppable watcher and does not create logs in missing folders', async t => {
	const root = await withProject(t, { config: {} });
	const component = new ErrorsComponent();
	const logs = [];
	component.log = (type, message) => logs.push({ type, message });
	const missing = path.join(root, 'no-such-folder/error.log');
	project.config = { errorLogPaths: [missing] };
	await component.watch();
	assert.equal(component.watcher, null);
	await assert.rejects(fs.access(path.dirname(missing)), { code: 'ENOENT' });
	assert.ok(logs.some(entry => /Cannot find error log/.test(entry.message)));

	const log = path.join(root, 'error.log');
	project.config = { errorLogPaths: [log] };
	await component.watch();
	await fs.access(log);
	assert.ok(component.watcher, 'tail is tracked so restarts can stop it');
	await component.stopWatching();
});

test('webpack config resolution restores NODE_ENV for the rest of the build', async t => {
	const root = await withProject(t, { config: {} });
	const block = path.join(root, 'blocks/example');
	await fs.mkdir(path.join(block, 'src'), { recursive: true });
	await fs.writeFile(path.join(root, 'package.json'), '{"name":"example"}');
	await fs.writeFile(path.join(block, 'src/block.json'), JSON.stringify({ name: 'custom/example', title: 'Example' }));
	await fs.writeFile(path.join(block, 'src/index.js'), 'export default 1;');
	const originalCwd = process.cwd();
	const originalEnv = process.env.NODE_ENV;
	process.chdir(root);
	t.after(() => {
		process.chdir(originalCwd);
		if (originalEnv === undefined) { delete process.env.NODE_ENV; } else { process.env.NODE_ENV = originalEnv; }
	});
	const component = new BlocksComponent();
	for (const value of [undefined, 'development']) {
		if (value === undefined) { delete process.env.NODE_ENV; } else { process.env.NODE_ENV = value; }
		component.resolveBlockWebpackConfig(block, path.join(block, 'build'));
		assert.equal(process.env.NODE_ENV, value);
	}
});

const hasPHP = await execFileAsync('php', ['--version']).then(() => true, () => false);

test('PHP syntax checks handle unusual file names without shell expansion', { skip: !hasPHP && 'php is not installed' }, async t => {
	const root = await withProject(t, { config: {} });
	const component = new PHPComponent();
	const logs = [];
	component.log = (type, message) => logs.push({ type, message });
	// The checker runs from the package root, so an injected `touch` would leave its marker there.
	const marker = fileURLToPath(new URL('../injected', import.meta.url));
	t.after(() => fs.rm(marker, { force: true }));
	const names = ['$page.php', 'x$(touch injected).php', 'back`tick`.php'];
	for (const name of names) {
		const file = path.join(root, name);
		await fs.writeFile(file, '<?php echo 1;\n');
		assert.equal(await component.checkSyntax(file), true, name);
	}
	await assert.rejects(fs.access(marker), { code: 'ENOENT' });
	await fs.writeFile(path.join(root, 'broken.php'), '<?php echo ;\n');
	assert.equal(await component.checkSyntax(path.join(root, 'broken.php')), false);
	assert.ok(logs.some(entry => entry.type === 'error'));
});

test('default PHP and HTML discovery skips dependency directories', async t => {
	const root = await withProject(t, { config: {} });
	for (const file of ['a.php', 'node_modules/x/b.php', 'vendor/y/c.php', 'inc/d.php']) {
		await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
		await fs.writeFile(path.join(root, file), '<?php');
	}
	const component = new PHPComponent();
	await component.init();
	assert.deepEqual(component.globs.map(file => path.relative(root, file)).sort(), ['a.php', 'inc/d.php']);
});
