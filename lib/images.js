const project = require('./project.js');
const log = require('./logging.js');
const imagemin = require('imagemin');
const imageminJpegtran = require('imagemin-jpegtran');
const imageminPngquant = require('imagemin-pngquant');
const imageminSvgo = require('imagemin-svgo');

const buildImages = async (images) => {
	let timerStart = Date.now();
	const files = await imagemin([images + '*'], {
		destination: project.path + '/dist/images/' + (images.replace(project.path + '/_src/images/', '')),
		plugins: [
			imageminJpegtran(),
			imageminPngquant(),
			imageminSvgo()
		]
	});
	log('success', `Built /dist/images/${images.replace(project.path + '/_src/images/', '')} in ${Date.now() - timerStart}ms`);
};

module.exports = buildImages;
