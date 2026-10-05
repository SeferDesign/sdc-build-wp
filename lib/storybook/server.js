import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { loadWordPressTheme } from './wordpress.js';

export function storybookOptions(project) {
	const config = project.config.storybook || {};
	const sourceURL = config.sourceURL || project.config.browsersync?.localProxyURL;
	if (!sourceURL) {
		throw new Error('Storybook needs storybook.sourceURL or browsersync.localProxyURL pointing to WordPress');
	}
	const port = config.port ?? 6006;
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error('Storybook port must be an integer between 1 and 65535');
	}
	return { sourceURL, port };
}

export async function startStorybook(project, log, onSpawn = () => {}) {
	const { sourceURL, port } = storybookOptions(project);
	await loadWordPressTheme(project.path, sourceURL);
	const cli = fileURLToPath(new URL('dist/bin/dispatcher.js', import.meta.resolve('storybook/package.json')));
	const child = spawn(process.execPath, [
		cli, 'dev', '--ci', '--no-open', '--disable-telemetry', '--exact-port',
		'--host', '127.0.0.1', '--port', String(port),
		'--config-dir', fileURLToPath(new URL('.', import.meta.url))
	], {
		cwd: project.path,
		env: { ...process.env, SDC_STORYBOOK_THEME: project.path, SDC_STORYBOOK_SOURCE: sourceURL },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let failure;
	let stopping = false;
	child.on('error', error => { failure = error; });
	child.on('exit', (code, signal) => {
		failure = new Error(`Storybook exited (${signal || code})`);
		if (!stopping) { log('error', failure.message); }
	});
	child.stdout.on('data', data => log('info', data.toString().trim()));
	child.stderr.on('data', data => log('warn', data.toString().trim()));
	child.sdcStop = () => { stopping = true; };
	onSpawn(child);
	const url = `http://127.0.0.1:${port}`;
	try {
		const deadline = Date.now() + 120000;
		while (Date.now() < deadline) {
			if (failure) { throw failure; }
			try {
				const response = await fetch(`${url}/index.json`, { signal: AbortSignal.timeout(1000) });
				if (response.ok) {
					const index = await response.json();
					if (index.entries) {
						log('info', `Storybook: ${url}`);
						return child;
					}
				}
			} catch (error) {
				if (error.name !== 'TimeoutError' && error.cause?.code !== 'ECONNREFUSED') { throw error; }
			}
			await delay(250);
		}
		throw new Error('Storybook did not become ready within 120 seconds');
	} catch (error) {
		stopping = true;
		await stopStorybook(child);
		throw error;
	}
}

export async function stopStorybook(child) {
	if (!child?.pid || child.exitCode !== null || child.signalCode !== null) { return; }
	child.sdcStop?.();
	const exited = once(child, 'exit');
	child.kill('SIGTERM');
	const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
	try {
		await exited;
	} finally {
		clearTimeout(timeout);
	}
}
