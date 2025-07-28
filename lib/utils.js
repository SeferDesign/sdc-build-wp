import path from 'path';
import { promises as fs } from 'fs';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'url';
import project from './project.js';

export async function getThisPackageVersion() {
	return JSON.parse(await fs.readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '../package.json'))).version
}

export function clearScreen() {
	if (!process.stdout.isTTY) { return; }
	process.stdout.write('\x1B[2J\x1B[0f');
}

export function stopActiveComponents() {
	if (project.components.server?.server) {
		try {
			project.components.server.server.exit();
		} catch (error) {
			console.warn('Failed to stop server:', error.message);
		}
	}
	Object.values(project.components).forEach(component => {
		if (component.watcher) {
			try {
				component.watcher.close();
			} catch (error) {
				console.warn(`Failed to stop watcher for ${component.constructor.name}:`, error.message);
			}
		}
	});
	if (project.components.scripts) {
		project.components.scripts.isBuilding = false;
	}
}

export function camelToDash(camel) {
	return camel.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
}

export function entryBasename(entry) {
	return path.parse(entry).base;
}

export async function getAllFiles(dir, filetypes = false) {
	let files = [];
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
	return files;
}

export async function getAllSubdirectories(dir) {
	let subdirectories = [];
	const subdirectoriesEntries = await readdir(dir, { withFileTypes: true });
	for (const subdirectoriesEntry of subdirectoriesEntries) {
		if (subdirectoriesEntry.isDirectory()) {
			const subdirPath = path.join(dir, subdirectoriesEntry.name);
			subdirectories.push(subdirPath);
			const nestedSubdirs = await getAllSubdirectories(subdirPath);
			subdirectories = subdirectories.concat(nestedSubdirs);
		}
	}
	return subdirectories;
}

export async function getImportedSASSFiles(filePath) {
	const content = await fs.readFile(filePath, 'utf8');
	const regex = /@(?:import|use)\s+['"]([^'"]+)['"]/g;
	const imports = [];
	let match;
	while ((match = regex.exec(content)) !== null) {
		let endFileName = match[1] + '.scss';
		imports.push(path.resolve(path.dirname(filePath), endFileName));
		if (match[1].includes('/')) {
			const matchSlashesRegex = match[1].match(/\/([^\/]*)$/);
			const everythingAfterLastSlash = matchSlashesRegex ? matchSlashesRegex[1] : null;
			imports.push(path.resolve(path.dirname(filePath), endFileName.replace(`${everythingAfterLastSlash}.scss`, `_${everythingAfterLastSlash}.scss`)));
		}
	}
	return imports;
}

export async function getImportedJSFiles(filePath) {
	try {
		const content = await fs.readFile(filePath, 'utf8');
		const regex = /(?:import\s+[^'"]*\s+from\s+['"`]([^'">`]+)['"`]|import\s*\(\s*['"`]([^'">`]+)['"`]\s*\)|require\s*\(\s*['"`]([^'">`]+)['"`]\s*\))/g;
		const imports = [];
		let match;

		while ((match = regex.exec(content)) !== null) {
			const importPath = match[1] || match[2] || match[3];
			if (importPath.startsWith('.') || importPath.startsWith('/')) {
				let resolvedPath;
				if (importPath.startsWith('.')) {
					resolvedPath = path.resolve(path.dirname(filePath), importPath);
				} else {
					resolvedPath = path.resolve(project.path, importPath.substring(1));
				}
				const extensions = ['.js', '.jsx', '.ts', '.tsx', '.mjs'];
				if (!path.extname(resolvedPath)) {
					for (const ext of extensions) {
						const pathWithExt = resolvedPath + ext;
						try {
							await fs.access(pathWithExt);
							imports.push(pathWithExt);
							break;
						} catch {
							// File does not exist
						}
					}
					const indexPath = path.join(resolvedPath, 'index');
					for (const ext of extensions) {
						const pathWithExt = indexPath + ext;
						try {
							await fs.access(pathWithExt);
							imports.push(pathWithExt);
							break;
						} catch {
							// File does not exist
						}
					}
				} else {
					try {
						await fs.access(resolvedPath);
						imports.push(resolvedPath);
					} catch {
						// File does not exist
					}
				}
			}
		}
		const unique = [...new Set(imports)];
		const finalList = [];
		for (const imp of unique) {
			if (!imp.startsWith(project.path)) { continue; }
			try {
				await fs.access(imp);
				finalList.push(imp);
			} catch {
				// File does not exist
			}
		}
		return finalList;
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
	for (const dep of directDeps) {
		const nestedDeps = await getAllJSDependencies(dep, visited);
		allDeps.push(...nestedDeps);
	}
	return [...new Set(allDeps)];
}

export function addEntriesByFiletypes(filetypes = []) {
	let finalFiles = [];
	for (const [name, files] of Object.entries(project.package.sdc.entries)) {
		for (let file of files) {
			let fullPath = project.path + file;
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
