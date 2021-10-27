const pathConfig = require('path');
const parentPath = process.cwd();
const log = require('node-pretty-log');
const imagemin = require('imagemin');
const imageminJpegtran = require('imagemin-jpegtran');
const imageminPngquant = require('imagemin-pngquant');

const buildImages = async (images) => {
	let timerStart = Date.now();
	log('info', `Building ${images.replace(parentPath, '')}...`);
	const files = await imagemin([images + '*'], {
		destination: parentPath + '/dist/images/' + (images.replace(parentPath + '/_src/images/', '')),
		plugins: [
			imageminJpegtran(),
			imageminPngquant()
		]
	});
	log('success', `Built /dist/images/${images.replace(parentPath + '/_src/images/', '')} in ${Date.now() - timerStart}ms`);
};

module.exports = buildImages;
