import BaseComponent from './base.js';
import imagemin from 'imagemin';
import imageminJpegtran from 'imagemin-jpegtran';
import imageminPngquant from 'imagemin-pngquant';
import imageminSvgo from 'imagemin-svgo';

export default class ImagesComponent extends BaseComponent {

	constructor() {
		super();
		this.slug = 'images';
	}

	async init() {
		this.globs = await Array.fromAsync(
			this.glob(this.project.package?.sdc?.imagesPath ||
			`${this.project.paths.images}/**/*`)
		);
		this.globsDirectories = [
			this.project.paths.images,
			...await this.utils.getAllSubdirectories(this.project.paths.images)
		];
		await this.process();
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
		const promisesImages = this.globsDirectories.map(directory => this.build(directory));
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
