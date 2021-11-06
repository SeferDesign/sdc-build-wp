import { readFile } from 'fs/promises';

export default {
	path: process.cwd(),
	package: JSON.parse(await readFile(new URL(process.cwd() + '/package.json', import.meta.url)))
};
