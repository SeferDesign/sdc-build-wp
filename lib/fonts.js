const project = require('./project.js');
const log = require('./logging.js');
const fs = require('fs-extra');

const buildFonts = async (fonts) => {
	let timerStart = Date.now();
	await fs.copy(fonts, project.path + '/dist/fonts');
	log('success', `Built /dist/fonts in ${Date.now() - timerStart}ms`);
};

module.exports = buildFonts;
