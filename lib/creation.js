import path from 'node:path';
import { lstat } from 'node:fs/promises';
import { slugify } from './utils.js';

export function getCreationDestination(type, name) {
	const slug = slugify(name.trim());
	switch (type) {
	case 'Block': return `blocks/${slug}`;
	case 'Pattern': return `patterns/${slug}.php`;
	case 'Style variation': return `styles/${slug}.json`;
	default: throw new Error(`Unknown component type: ${type}`);
	}
}

export async function validateCreation(root, type, name) {
	if (!slugify(name.trim())) {
		throw new Error('Enter a name containing letters or numbers.');
	}
	const destination = getCreationDestination(type, name);
	try {
		await lstat(path.join(root, destination));
	} catch (error) {
		if (error.code === 'ENOENT') {
			return;
		}
		throw new Error(`Cannot check ${destination}: ${error.message}`, { cause: error });
	}
	throw new Error(`${destination} already exists. Choose a different name.`);
}
