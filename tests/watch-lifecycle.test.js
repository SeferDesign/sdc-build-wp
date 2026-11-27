import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { makeTheme, run, startWatch } from './helpers/index.js';

const configFile = root => path.join(root, '.sdc-build-wp/config.json');
const readConfig = async root => JSON.parse(await fs.readFile(configFile(root), 'utf8'));
const writeConfig = (root, config) => fs.writeFile(configFile(root), JSON.stringify(config));

test('watch mode reloads valid config changes, survives bad ones and keeps watching the config', { timeout: 90000 }, async t => {
	const root = await makeTheme(t);
	const config = await readConfig(root);
	const session = await startWatch(t, root);
	assert.equal(session.count('Started watching'), 1);

	// An invalid edit keeps the previous configuration instead of exiting.
	await writeConfig(root, { ...config, typo: true });
	await session.waitFor('Keeping the previous configuration');
	assert.match(session.getOutput(), /Configuration error at '\/\/typo'/);
	assert.equal(session.child.exitCode, null, 'the session is still running');
	assert.equal(session.count('Started watching'), 1, 'a rejected config does not restart the build');

	// A malformed file is rejected the same way.
	await fs.writeFile(configFile(root), '{');
	await session.waitFor('Keeping the previous configuration', 2);
	assert.equal(session.child.exitCode, null);

	// A valid edit restarts the build with the new configuration...
	await writeConfig(root, { ...config, port: 3101 });
	await session.waitFor('Started watching', 2);

	// ...and the config watcher is re-armed, so the next edit also reloads.
	await writeConfig(root, { ...config, port: 3102 });
	await session.waitFor('Started watching', 3);
	assert.equal(session.child.exitCode, null);

	session.child.kill('SIGTERM');
	assert.equal((await session.exited).code, 143, session.getOutput());
});

test('watch mode rebuilds changed sources after a restart', { timeout: 60000 }, async t => {
	const root = await makeTheme(t);
	const config = await readConfig(root);
	const session = await startWatch(t, root);
	await writeConfig(root, { ...config, port: 3103 });
	await session.waitFor('Started watching', 2);
	await new Promise(resolve => setTimeout(resolve, 500)); // let the new watchers settle

	const builds = session.count('Built /dist/style/main\\.min\\.css');
	await fs.writeFile(path.join(root, '_src/style/partials/_tokens.scss'), '$accent: #abcdef;\n');
	await session.waitFor('Built /dist/style/main\\.min\\.css', builds + 1);
	assert.match(await fs.readFile(path.join(root, 'dist/style/main.min.css'), 'utf8'), /#abcdef/);
});

test('validation reports Sass token problems, unreadable asset URIs and files outside the project', async t => {
	const root = await makeTheme(t, { wordpress: true });
	const themePath = path.join(root, 'theme.json');
	const theme = JSON.parse(await fs.readFile(themePath, 'utf8'));
	theme.settings.custom = {
		'1bad': 'x',
		a_b: 1,
		'a-b': 2,
		font: 'file:../outside.woff2',
		broken: 'file:%E0%A4%A',
		missing: 'url(file:./nowhere/font.woff2)',
		'breakpoints-rem': { sm: 40, md: '60rem' },
		'breakpoint-mobile': 'xl'
	};
	theme.settings.color = { palette: [{ slug: 'brand', color: '#123456' }, { slug: 'brand', color: '#654321' }] };
	await fs.writeFile(themePath, JSON.stringify(theme));

	const { code, output } = await run(root, ['--builds=style', '--no-cache']);
	assert.equal(code, 1, output);
	for (const expected of [
		/Preset generates an invalid Sass variable: \$1bad/,
		/Sass variable \$a-b collides with .*hyphens and underscores are equivalent/,
		/Local asset escapes the project: file:\.\.\/outside\.woff2/,
		/Invalid local asset URI: file:%E0%A4%A/,
		/Local asset not found: file:\.\/nowhere\/font\.woff2/,
		/Mobile breakpoint does not name a configured breakpoint/,
		/Sass variable \$brand collides with/
	]) {
		assert.match(output, expected);
	}
});
