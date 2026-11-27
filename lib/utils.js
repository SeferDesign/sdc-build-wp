import path from 'path';
import { promises as fs } from 'fs';
import { readdir } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'url';
import project from './project.js';
import log from './logging.js';
import tui from './tui.js';

export async function getThisPackageVersion() {
	return JSON.parse(await fs.readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '../package.json'))).version
}

export function clearScreen() {
	if (!process.stdout.isTTY) { return; }
	if (tui.isInitialized) { return; }
	process.stdout.write('\x1B[2J\x1B[0f');
}

export async function stopActiveComponents() {
	if (project.configWatcher) {
		try {
			await project.configWatcher.close();
		} catch (error) {
			log(null, error);
			log('error', 'Failed to stop config file watcher');
		}
		project.configWatcher = null;
	}
	if (project.components.server?.server) {
		try {
			project.components.server.server.exit();
		} catch (error) {
			log(null, error);
			log('error', 'Failed to stop server');
		}
	}
	for (const component of Object.values(project.components)) {
		if (component.isBuilding) {
			component.isBuilding = false;
		}
		if (component.watcher) {
			try {
				await component.stopWatching();
			} catch (error) {
				log(null, error);
				log('error', `Failed to stop watcher for ${component.constructor.name}`);
			}
		}
	}
	await project.components.cache?.flushManifest();
	await project.validationWatcher?.stopWatching();
	project.validationWatcher = null;
}

export function camelToDash(camel) {
	return camel.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
}

export function entryBasename(entry) {
	return path.parse(entry).base;
}

export async function getAllFiles(dir, filetypes = false) {
	let files = [];
	try {
		const entries = await readdir(dir, { withFileTypes: true });
		if (filetypes && !Array.isArray(filetypes)) {
			filetypes = [filetypes];
		}
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			if (
				!entry.isDirectory() &&
				(!filetypes || filetypes.length == 0 || filetypes.includes(path.extname(fullPath)))
			) {
				files.push(fullPath);
			}
		}
	} catch (error) {
		//
	}
	return files;
}

export async function getWordPressProjectLabel(root) {
	const readHeader = async (file, headerName) => {
		try {
			const content = (await fs.readFile(file, 'utf8')).slice(0, 8192);
			return content.match(new RegExp(`^\\s*\\*?\\s*${headerName}:\\s*(.+?)\\s*$`, 'im'))?.[1] || null;
		} catch {
			return null;
		}
	};

	const themeName = await readHeader(path.join(root, 'style.css'), 'Theme Name');
	if (themeName) {
		return `Theme: ${themeName}`;
	}

	const pluginFiles = (await getAllFiles(root, '.php')).sort((first, second) => {
		const firstName = path.basename(first);
		const secondName = path.basename(second);
		const directoryName = path.basename(root);
		const priority = file => path.parse(file).name === directoryName ? 0 : path.basename(file) === 'index.php' ? 1 : 2;
		return priority(first) - priority(second) || firstName.localeCompare(secondName);
	});
	for (const file of pluginFiles) {
		const pluginName = await readHeader(file, 'Plugin Name');
		if (pluginName) {
			return `Plugin: ${pluginName}`;
		}
	}
	return null;
}

export async function getAllSubdirectories(dir) {
	const subdirectoriesEntries = await readdir(dir, { withFileTypes: true });
	const subdirectories = subdirectoriesEntries
		.filter(entry => entry.isDirectory())
		.map(entry => path.join(dir, entry.name));
	const nestedSubdirectories = await Promise.all(
		subdirectories.map(subdirectory => getAllSubdirectories(subdirectory))
	);
	return subdirectories.flatMap((subdirectory, index) => [subdirectory, ...nestedSubdirectories[index]]);
}

export function isSassPartial(file) {
	return path.extname(file) === '.scss' && path.basename(file).startsWith('_');
}

function getSassImportCandidates(fromFile, specifier) {
	if (/^(?:[a-z][a-z0-9+.-]*:|~)/i.test(specifier) || specifier.endsWith('.css')) { return []; }
	const base = path.resolve(path.dirname(fromFile), specifier).replace(/\.scss$/, '');
	const directory = path.dirname(base);
	const name = path.basename(base);
	return [`${base}.scss`, path.join(directory, `_${name}.scss`), path.join(base, 'index.scss'), path.join(base, '_index.scss')];
}

async function collectSassDependencies(filePath, found, visited, isEntry) {
	if (visited.has(filePath)) { return; }
	visited.add(filePath);
	let content;
	try {
		content = await fs.readFile(filePath, 'utf8');
	} catch (error) {
		if (!isEntry && ['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code)) { return; }
		throw error;
	}
	content = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
	for (const [, specifiers] of content.matchAll(/@(?:use|forward|import)\s+((?:['"][^'"]+['"]\s*,?\s*)+)/g)) {
		for (const [, specifier] of specifiers.matchAll(/['"]([^'"]+)['"]/g)) {
			for (const candidate of getSassImportCandidates(filePath, specifier)) {
				found.add(candidate);
				await collectSassDependencies(candidate, found, visited, false);
			}
		}
	}
}

// Returns every Sass file an entry can load, including nested imports and each
// partial/index candidate, so creating a shadowing file also invalidates builds.
export async function getImportedSASSFiles(filePath) {
	const entry = path.resolve(filePath);
	const found = new Set();
	await collectSassDependencies(entry, found, new Set(), true);
	found.delete(entry);
	return [...found];
}

export async function getImportedJSFiles(filePath) {
	try {
		const content = await fs.readFile(filePath, 'utf8');
		// static imports, side-effect imports, re-exports, dynamic imports and require()
		const regex = /(?:\b(?:import|export)\s+(?:[^'"`;]*?\bfrom\s*)?|\bimport\s*\(\s*|\brequire\s*\(\s*)['"`]([^'"`\n]+)['"`]/g;
		const importPaths = [...content.matchAll(regex)].map(match => match[1]);

		const imports = await Promise.all(importPaths.map(async importPath => {
			if (!importPath.startsWith('.') && !importPath.startsWith('/')) { return []; }

			const resolvedPath = importPath.startsWith('.')
				? path.resolve(path.dirname(filePath), importPath)
				: path.resolve(project.path, importPath.substring(1));
			if (!resolvedPath.startsWith(project.path)) { return []; }

			const extensions = ['.js', '.jsx', '.ts', '.tsx', '.mjs'];
			const findFirstExisting = async candidates => {
				const exists = await Promise.all(candidates.map(async candidate => {
					try {
						await fs.access(candidate);
						return true;
					} catch {
						return false;
					}
				}));
				const index = exists.indexOf(true);
				return index === -1 ? null : candidates[index];
			};

			if (path.extname(resolvedPath)) {
				return await findFirstExisting([resolvedPath]) || [];
			}

			const fileCandidate = await findFirstExisting(extensions.map(extension => resolvedPath + extension));
			if (fileCandidate) { return [fileCandidate]; }

			const indexPath = path.join(resolvedPath, 'index');
			const indexCandidate = await findFirstExisting(extensions.map(extension => indexPath + extension));
			return indexCandidate ? [indexCandidate] : [];
		}));
		return [...new Set(imports.flat())];
	} catch (error) {
		return [];
	}
}

export async function getAllJSDependencies(filePath, visited = new Set()) {
	if (visited.has(filePath)) {
		return [];
	}
	visited.add(filePath);
	const directDeps = await getImportedJSFiles(filePath);
	const allDeps = [...directDeps];
	const nestedDependencies = await Promise.all(
		directDeps.map(dependency => getAllJSDependencies(dependency, visited))
	);
	allDeps.push(...nestedDependencies.flat());
	return [...new Set(allDeps)];
}

export function addEntriesByFiletypes(filetypes = [], currentProject = project) {
	let finalFiles = [];
	for (const [name, files] of Object.entries(currentProject.entries)) {
		for (let file of files) {
			let fullPath = currentProject.path + file;
			let extension = path.parse(fullPath).ext;
			if (filetypes.includes(extension)) {
				finalFiles.push({
					'name': name,
					'file': fullPath
				});
			}
		}
	}
	return finalFiles;
}

export function slugify(str) {
	return str
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, '')
		.trim()
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-');
}

export async function ensureDir(dir) {
	try {
		await fs.mkdir(dir, { recursive: true });
		return true;
	} catch (error) {
		log(null, error);
		log('error', `Failed to create directory ${dir}`);
		return false;
	}
}

// Minimum concurrency even on single-core machines, since builds spend significant time on process startup/IO rather than pure CPU work.
const MIN_BUILD_CONCURRENCY = 4;
const pendingBuildTasks = [];
let activeBuildTasks = 0;

export function getComponentConcurrency(componentName, fallback = null) {
	const configured = project.config?.buildConcurrency || {};
	const machineDefault = Math.max(MIN_BUILD_CONCURRENCY, availableParallelism() - 1);
	const defaultLimit = normalizeConcurrency(configured.default, machineDefault);
	return normalizeConcurrency(configured[componentName], fallback ?? defaultLimit);
}

export function withBuildSlot(iterator) {
	return new Promise((resolve, reject) => {
		pendingBuildTasks.push({ iterator, resolve, reject });
		drainBuildTasks();
	});
}

function drainBuildTasks() {
	const limit = getComponentConcurrency('total');
	while (activeBuildTasks < limit && pendingBuildTasks.length > 0) {
		const task = pendingBuildTasks.shift();
		activeBuildTasks++;
		runBuildTask(task);
	}
}

async function runBuildTask(task) {
	try {
		task.resolve(await task.iterator());
	} catch (error) {
		task.reject(error);
	} finally {
		activeBuildTasks--;
		drainBuildTasks();
	}
}

export async function runWithConcurrency(items, concurrency, iterator) {
	const queue = Array.from(items);
	if (queue.length === 0) {
		return [];
	}

	const limit = Math.min(normalizeConcurrency(concurrency, 1), queue.length);
	const results = new Array(queue.length);
	let nextIndex = 0;

	const worker = async () => {
		while (nextIndex < queue.length) {
			const currentIndex = nextIndex;
			nextIndex++;
			results[currentIndex] = await iterator(queue[currentIndex], currentIndex);
		}
	};

	await Promise.all(Array.from({ length: limit }, () => worker()));
	return results;
}

function normalizeConcurrency(value, fallback) {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return fallback;
	}

	const normalized = Math.floor(value);
	return normalized > 0 ? normalized : fallback;
}
