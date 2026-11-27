import { promises as fs } from 'node:fs';
import path from 'node:path';

export const configPathFromRoot = '.sdc-build-wp/config.json';

const sourceRoot = '_src';
const starterFiles = {
	style: ['main.scss', '// Theme styles. Add partials in a partials/ folder and @use them here.\n'],
	scripts: ['main.js', '// Theme scripts. Import modules from this folder and they are bundled into dist/.\n']
};
const sourceDirectories = ['style', 'scripts', 'images', 'fonts'];

export function getConfigTemplate() {
	return { $schema: '../node_modules/sdc-build-wp/config.schema.json' };
}

async function exists(file) {
	try {
		await fs.access(file);
		return true;
	} catch (error) {
		if (!['ENOENT', 'ENOTDIR'].includes(error.code)) { throw error; }
		return false;
	}
}

export async function writeConfigFile(root, { overwrite = false } = {}) {
	const file = path.join(root, configPathFromRoot);
	if (!overwrite && await exists(file)) { return false; }
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(file, `${JSON.stringify(getConfigTemplate(), null, '\t')}\n`);
	return true;
}

// Creates a missing source directory; starter files are only added to directories that were new
// or empty, so existing work is never touched.
export async function ensureSourceDirectory(root, name) {
	const directory = path.join(root, sourceRoot, name);
	const created = !(await exists(directory));
	await fs.mkdir(directory, { recursive: true });
	const starter = starterFiles[name];
	if (starter && (created || (await fs.readdir(directory)).length === 0)) {
		await fs.writeFile(path.join(directory, starter[0]), starter[1]);
		return { directory, created, starter: starter[0] };
	}
	if (created && !starter) { await fs.writeFile(path.join(directory, '.gitkeep'), ''); }
	return { directory, created, starter: null };
}

// Scaffolds .sdc-build-wp/config.json and the _src folders. Returns what happened for each path.
export async function initProject({ root, force = false, legacyConfig = null }) {
	const results = [];
	const relative = file => path.relative(root, file).split(path.sep).join('/');
	const configFile = path.join(root, configPathFromRoot);
	if (legacyConfig) {
		results.push({ status: 'skipped', path: configPathFromRoot, message: 'package.json contains legacy "sdc" settings; the next build migrates them to this file' });
	} else if (await writeConfigFile(root, { overwrite: force })) {
		results.push({ status: 'created', path: relative(configFile), message: force ? 'Wrote configuration' : 'Created configuration' });
	} else {
		results.push({ status: 'skipped', path: relative(configFile), message: 'Configuration already exists (use --force to replace it)' });
	}
	for (const name of sourceDirectories) {
		const { directory, created, starter } = await ensureSourceDirectory(root, name);
		if (created) {
			results.push({ status: 'created', path: `${relative(directory)}/`, message: starter ? `Created source directory with ${starter}` : 'Created source directory' });
		} else if (starter) {
			results.push({ status: 'created', path: `${relative(directory)}/${starter}`, message: 'Added starter file to the empty directory' });
		} else {
			results.push({ status: 'skipped', path: `${relative(directory)}/`, message: 'Source directory already exists' });
		}
	}
	return results;
}
