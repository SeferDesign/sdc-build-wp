const project = require('./project.js');
const log = require('./logging.js');
const fs = require('fs-extra');
const { readdir } = require('fs/promises');

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

module.exports = buildFonts;
