import BaseComponent from './base.js';
import { promises as fs } from 'fs';
import sharp from 'sharp';
import { optimize } from 'svgo';

export default class ImagesComponent extends BaseComponent {

	constructor() {
		super();
		this.description = `Compress image files`;
		this.compressableFileFormats = ['.jpg', '.jpeg', '.png', '.svg'];
	}

	async init() {
		this.globs = await Array.fromAsync(
			this.glob(this.project.config.imagesPath ||
			`${this.project.paths.images}/**/*`)
		);
		this.globsDirectories = [
			this.project.paths.images,
			...await this.utils.getAllSubdirectories(this.project.paths.images)
		];
		await this.process();
	}

	async build(entry, options) {
		let timerStart = performance.now();
		let dest = entry.replace(`${this.project.paths.src.src}/${this.project.paths.src.images}`, `${this.project.paths.dist}/${this.project.paths.src.images}`);
		const files = await fs.readdir(entry);
		await fs.mkdir(dest, { recursive: true });

		let convertedImagesCount = 0;
		let copiedFilesCount = 0;
		for (const file of files) {
			if (file == '.DS_Store') {
				continue;
			}
			const filePath = this.path.join(entry, file);
			const destFilePath = `${dest}/${this.path.basename(file)}`;
			if (!this.compressableFileFormats.includes(this.path.extname(file).toLowerCase())) {
				if (this.path.extname(file)) {
					await fs.copyFile(filePath, destFilePath);
					copiedFilesCount++;
				}
				continue;
			}
			try {
				if (this.path.extname(file) == '.svg') {
					const result = optimize(await fs.readFile(filePath, 'utf8'), {
						multipass: true,
						plugins: [
							'preset-default'
						]
					});
					await fs.writeFile(destFilePath, result.data);
				} else {
					await sharp(filePath).toFile(destFilePath);
				}
				convertedImagesCount++;
			} catch (error) {
				this.log(null, error);
				this.log('error', `Failed optimizing ${filePath.replace(this.project.path, '')} - See above error.`);
			}

		}

		this.end({
			itemLabel: `${dest.replace(this.project.path, '')} (${convertedImagesCount} image${convertedImagesCount == 1 ? '' : 's'}${copiedFilesCount ? `, ${copiedFilesCount} file${copiedFilesCount == 1 ? '' : 's'}` : ''})`,
			timerStart: timerStart,
			timerEnd: performance.now()
		});
	}

	async process() {
		const promisesImages = this.globsDirectories.map(directory => this.build(directory));
		await Promise.all(promisesImages);
	}

	watch() {
		this.watcher = this.chokidar.watch(this.project.paths.images, {
			...this.project.chokidarOpts
		}).on('all', async (event, path) => {
			if (!this.project.isRunning) { return; }
			try {
				await this.process();
			} catch (error) {
				this.log('error', `Failed to process images: ${error.message}`);
			}
		});
	}

}
