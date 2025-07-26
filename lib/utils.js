import path from 'path';
import fs from 'fs';
import * as fsPromises from 'fs/promises';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'url';
import project from './project.js';

export async function getThisPackageVersion() {
	return JSON.parse(await fsPromises.readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '../package.json'))).version
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

export function getImportedSASSFiles(filePath) {
	const content = fs.readFileSync(filePath, 'utf8');
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

export function getImportedJSFiles(filePath) {
	try {
		const content = fs.readFileSync(filePath, 'utf8');
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
						if (fs.existsSync(pathWithExt)) {
							imports.push(pathWithExt);
							break;
						}
					}
					const indexPath = path.join(resolvedPath, 'index');
					for (const ext of extensions) {
						const pathWithExt = indexPath + ext;
						if (fs.existsSync(pathWithExt)) {
							imports.push(pathWithExt);
							break;
						}
					}
				} else {
					if (fs.existsSync(resolvedPath)) {
						imports.push(resolvedPath);
					}
				}
			}
		}
		return [...new Set(imports)].filter(importPath =>
			importPath.startsWith(project.path) && fs.existsSync(importPath)
		);
	} catch (error) {
		return [];
	}
}

export function getAllJSDependencies(filePath, visited = new Set()) {
	if (visited.has(filePath)) {
		return [];
	}
	visited.add(filePath);
	const directDeps = getImportedJSFiles(filePath);
	const allDeps = [...directDeps];
	for (const dep of directDeps) {
		const nestedDeps = getAllJSDependencies(dep, visited);
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
