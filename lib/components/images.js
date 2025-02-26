import BaseComponent from './base.js';
import imagemin from 'imagemin';
import imageminJpegtran from 'imagemin-jpegtran';
import imageminPngquant from 'imagemin-pngquant';
import imageminSvgo from 'imagemin-svgo';

class ImagesComponent extends BaseComponent {

	constructor() {
		super();
	}

	async build(entry, options) {
		let timerStart = Date.now();
		let dest = entry.replace('_src/images', 'dist/images');
		const files = await imagemin([entry + '/*'], {
			destination: dest,
			plugins: [
				imageminJpegtran(),
				imageminPngquant(),
				imageminSvgo()
			]
		});

		this.end({
			itemLabel: `${dest.replace(this.project.path, '')} (${files.length} image${files.length == 1 ? '' : 's'})`,
			timerStart: timerStart,
			timerEnd: Date.now()
		});
	}

	async process() {
		const promisesImages = this.project.globs.imageDirectories.map(directory => this.build(directory));
		await Promise.all(promisesImages);
	}

	watch() {
		this.chokidar.watch(this.project.paths.images, {
			...this.project.chokidarOpts
		}).on('all', (event, path) => {
			this.process();
		});
	}

}

export { ImagesComponent as default }
