const parentPath = process.cwd();
const log = require('node-pretty-log');
const fs = require('fs-extra');

const buildFonts = async (fonts) => {
	let timerStart = Date.now();
	log('info', `Building ${fonts.replace(parentPath, '')}...`);
	await fs.copy(fonts, parentPath + '/dist/fonts');
	log('success', `Built /dist/fonts in ${Date.now() - timerStart}ms`);
};

module.exports = buildFonts;
