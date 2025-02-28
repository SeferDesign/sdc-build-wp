import fs from 'fs';
import { readdir } from 'node:fs/promises';
import path from 'path';
import project from './project.js';

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
