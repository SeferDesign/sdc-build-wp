import project from '../lib/project.js';
import log from './logging.js';
import imagemin from 'imagemin';
import imageminJpegtran from 'imagemin-jpegtran';
import imageminPngquant from 'imagemin-pngquant';
import imageminSvgo from 'imagemin-svgo';

const buildImages = async (images) => {
	let timerStart = Date.now();
	let dest = images.replace('_src/images', 'dist/images');
	const files = await imagemin([images + '/*'], {
		destination: dest,
		plugins: [
			imageminJpegtran(),
			imageminPngquant(),
			imageminSvgo()
		]
	});
	log('success', `Built ${dest.replace(project.path, '')} (${files.length} image${files.length == 1 ? '' : 's'}) in ${Date.now() - timerStart}ms`);
};

export default buildImages;
