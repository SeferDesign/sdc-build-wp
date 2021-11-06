import project from '../lib/project.js';
import log from './logging.js';
import imagemin from 'imagemin';
import imageminJpegtran from 'imagemin-jpegtran';
import imageminPngquant from 'imagemin-pngquant';
import imageminSvgo from 'imagemin-svgo';

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

export default buildImages;
