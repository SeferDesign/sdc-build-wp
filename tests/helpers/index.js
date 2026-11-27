import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import project from '../../lib/project.js';

const execFileAsync = promisify(execFile);
export const cli = fileURLToPath(new URL('../../index.js', import.meta.url));
export const fixture = fileURLToPath(new URL('../fixtures/theme/', import.meta.url));

// Copies the fixture theme into a temporary directory. With `wordpress`, it also fakes a
// WordPress 6.8 install and an offline schema cache so validation runs without a network.
export async function makeTheme(t, { wordpress = false } = {}) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-theme-'));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	await fs.cp(fixture, root, {
		recursive: true,
		filter: source => !['dist', path.join('.sdc-build-wp', 'cache'), path.join('_src', 'style', 'partials', '_theme.scss')]
			.includes(path.relative(fixture, source))
	});
	if (wordpress) {
		await fs.mkdir(path.join(root, 'wp-includes'), { recursive: true });
		await fs.writeFile(path.join(root, 'wp-includes/version.php'), '<?php\n$wp_version = "6.8";');
		const schemaCacheDir = path.join(root, '.sdc-build-wp/cache/schemas');
		await fs.mkdir(schemaCacheDir, { recursive: true });
		await fs.writeFile(path.join(schemaCacheDir, 'wordpress-6.8-theme.json'), JSON.stringify({ type: 'object', required: ['version'], properties: { version: { type: 'integer' } } }));
		await fs.writeFile(path.join(schemaCacheDir, 'wordpress-6.8-block.json'), JSON.stringify({ type: 'object', required: ['name', 'title'], properties: { name: { type: 'string' }, title: { type: 'string' } } }));
	}
	return root;
}

export async function writeConfig(root, config) {
	await fs.mkdir(path.join(root, '.sdc-build-wp'), { recursive: true });
	await fs.writeFile(path.join(root, '.sdc-build-wp/config.json'), JSON.stringify(config));
}

// Runs the CLI and resolves with its exit code and combined output instead of rejecting.
export async function run(cwd, args, env = {}) {
	try {
		const { stdout, stderr } = await execFileAsync(process.execPath, [cli, ...args], {
			cwd, timeout: 30000, env: { ...process.env, NODE_ENV: 'development', NO_COLOR: '1', FORCE_COLOR: '0', ...env }
		});
		return { code: 0, stdout, stderr, output: stdout + stderr };
	} catch (error) {
		return { code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '', output: `${error.stdout}${error.stderr}` };
	}
}

// Points the shared project singleton at a temporary directory for component-level tests.
export async function withProject(t, changes = {}) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-component-'));
	const original = { path: project.path, paths: project.paths, config: project.config, components: project.components };
	Object.assign(project, { path: root, components: {}, ...changes });
	project.paths = { ...original.paths, dist: 'dist', images: path.join(root, '_src/images'), ...changes.paths };
	t.after(async () => {
		Object.assign(project, original);
		await fs.rm(root, { recursive: true, force: true });
	});
	return root;
}

// Starts `sdc-build-wp --watch` and resolves once the first build has finished and watching began.
export async function startWatch(t, root, args = ['--builds=style,scripts', '--skip-validation']) {
	const child = spawn(process.execPath, [cli, ...args, '--watch'], {
		cwd: root, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }
	});
	let output = '';
	child.stdout.on('data', chunk => { output += chunk; });
	child.stderr.on('data', chunk => { output += chunk; });
	const exited = new Promise((resolve, reject) => {
		child.once('error', reject);
		child.once('exit', (code, signal) => resolve({ code, signal }));
	});
	t.after(async () => {
		if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); }
		await exited;
	});
	const session = {
		child,
		exited,
		getOutput: () => output,
		count: pattern => (output.match(new RegExp(pattern, 'g')) || []).length,
		// Waits until the pattern has appeared `times` times in the output.
		async waitFor(pattern, times = 1, timeout = 20000) {
			const deadline = Date.now() + timeout;
			while (session.count(pattern) < times) {
				if (child.exitCode !== null) { throw new Error(`Process exited early:\n${output}`); }
				if (Date.now() > deadline) { throw new Error(`Timed out waiting for ${pattern} x${times}:\n${output}`); }
				await new Promise(resolve => setTimeout(resolve, 50));
			}
		}
	};
	await session.waitFor('Started watching');
	return session;
}
