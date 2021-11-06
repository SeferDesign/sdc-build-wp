import project from '../lib/project.js';
import log from './logging.js';
import fs from 'fs-extra';
import { readdir } from 'fs/promises';

const buildFonts = async (fonts) => {
	let timerStart = Date.now();
	try {
		const fontsDir = await readdir(fonts);
		if (fontsDir.length == 0) { throw new Error('No files in directory'); }
		await fs.copy(fonts, project.path + '/dist/fonts');
		log('success', `Built /dist/fonts in ${Date.now() - timerStart}ms`);
	} catch {
		log('info', `No files present at ${fonts.replace(project.path, '')}/. Skipping font copy`);
		return false;
	}
};

export default buildFonts;
