import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { createSecureContext } from 'node:tls';
import { validateConfig, mergeWithDefaults } from './config-validator.js';

const execute = promisify(execFile);

async function checkPort(port) {
	await new Promise((resolve, reject) => {
		const server = createServer();
		server.once('error', reject);
		server.listen(port, '127.0.0.1', () => server.close(resolve));
	});
}

async function checkWritable(directory) {
	let current = directory;
	while (true) {
		try {
			await fs.access(current, constants.W_OK);
			if (!(await fs.stat(current)).isDirectory()) { throw new Error('not a directory'); }
			return;
		} catch (error) {
			if (error.code !== 'ENOENT' || current === path.dirname(current)) { throw error; }
			current = path.dirname(current);
		}
	}
}

export async function runDoctor({ root, builds, legacyConfig, environment = process.env }) {
	const checks = [];
	const add = (status, name, message) => checks.push({ status, name, message });
	const check = async (name, action, success, remedy) => {
		try {
			await action();
			add('pass', name, success);
		} catch (error) {
			add('error', name, `${remedy} (${error.code || error.message})`);
		}
	};
	add(Number(process.versions.node.split('.')[0]) >= 22 ? 'pass' : 'error', 'Node', `${process.version}; Node >=22 is required`);
	let rawConfig;
	try {
		rawConfig = JSON.parse(await fs.readFile(path.join(root, '.sdc-build-wp/config.json'), 'utf8'));
	} catch (error) {
		if (error.code !== 'ENOENT') {
			add('error', 'Configuration', `Fix .sdc-build-wp/config.json: ${error.message}`);
			return checks;
		}
		rawConfig = legacyConfig || {};
		add('warn', 'Configuration', legacyConfig ? 'Legacy package.json sdc settings detected; a build will migrate them' : 'No configuration file; defaults will be used');
	}
	if (!validateConfig(rawConfig)) {
		add('error', 'Configuration', 'Correct the schema errors above before building');
		return checks;
	}
	add('pass', 'Configuration', 'Configuration matches the published schema');
	const config = mergeWithDefaults(rawConfig);
	const source = { src: '_src', style: 'style', scripts: 'scripts', images: 'images', fonts: 'fonts', ...config.paths?.src };
	for (const component of ['style', 'scripts', 'images', 'fonts']) {
		if (!builds.includes(component)) { continue; }
		const directory = path.resolve(root, config[`${component}Path`] || path.join(source.src, source[component]));
		try {
			if (!(await fs.stat(directory)).isDirectory()) { throw new Error('not a directory'); }
			add('pass', `${component} sources`, path.relative(root, directory));
		} catch {
			add('warn', `${component} sources`, `Source directory is missing: ${path.relative(root, directory)}; create it if this component is needed`);
		}
	}
	for (const [name, entries] of Object.entries(config.entries || {})) {
		for (const entry of entries) {
			await check(`Entry ${name}`, async () => {
				if (!(await fs.stat(path.resolve(root, entry.replace(/^[/\\]+/, '')))).isFile()) { throw new Error('not a file'); }
			}, entry, `Create the configured entry or correct its path: ${entry}`);
		}
	}
	await check('Output directory', () => checkWritable(path.resolve(root, config.paths?.dist || 'dist')), 'Output directory or its parent is writable', 'Choose a writable paths.dist directory');
	if (builds.includes('php') && config.php.enabled) {
		await check('PHP', async () => {
			const { stdout } = await execute('php', ['--version'], { timeout: 3000 });
			const version = /PHP (\d+)\.(\d+)/.exec(stdout);
			if (!version || Number(version[1]) < 7 || (Number(version[1]) === 7 && Number(version[2]) < 4)) {
				throw new Error('PHP >=7.4 required by php-cs-fixer');
			}
		}, 'PHP is available and meets the formatter minimum', 'Install PHP >=7.4 and make php available on PATH');
		await check('PHP formatter', () => fs.access(new URL('../vendor/bin/php-cs-fixer', import.meta.url)), 'Bundled php-cs-fixer is available', 'Run composer install in the sdc-build-wp package directory');
	}
	if (builds.includes('server')) {
		await check('Port', () => checkPort(config.port || 3000), `Port ${config.port || 3000} is available on localhost`, 'Stop the process using the configured port or choose another port');
		if (config.browsersync?.localProxyURL) {
			await check('Proxy', async () => {
				const response = await fetch(config.browsersync.localProxyURL, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
				if (!response.ok) { throw new Error(`HTTP ${response.status}`); }
			}, 'Proxy origin responds successfully', 'Start WordPress and verify browsersync.localProxyURL and its certificate trust');
		} else {
			add('warn', 'Proxy', 'Set browsersync.localProxyURL to your local WordPress URL for proxy live reload');
		}
		if (environment.SSL_KEY_PATH || environment.SSL_CRT_PATH) {
			await check('TLS', async () => {
				if (!environment.SSL_KEY_PATH || !environment.SSL_CRT_PATH) { throw new Error('both SSL_KEY_PATH and SSL_CRT_PATH are required'); }
				createSecureContext({ key: await fs.readFile(environment.SSL_KEY_PATH), cert: await fs.readFile(environment.SSL_CRT_PATH) });
			}, 'TLS key and certificate can be loaded', 'Set SSL_KEY_PATH and SSL_CRT_PATH to a valid matching key and certificate');
		}
	}
	return checks;
}
