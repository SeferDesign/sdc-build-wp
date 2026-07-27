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

	getOutputPath(entry) {
		const sourceRoot = `${this.project.path}/${this.project.paths.src.src}/${this.project.paths.src.images}`;
		const destRoot = `${this.project.path}/${this.project.paths.dist}/${this.project.paths.src.images}`;
		return entry.replace(sourceRoot, destRoot);
	}

	async buildFile(filePath) {
		if (this.path.basename(filePath) == '.DS_Store' || !this.path.extname(filePath)) {
			return { convertedImagesCount: 0, copiedFilesCount: 0 };
		}

		const destFilePath = this.getOutputPath(filePath);
		await fs.mkdir(this.path.dirname(destFilePath), { recursive: true });

		if (!this.compressableFileFormats.includes(this.path.extname(filePath).toLowerCase())) {
			await fs.copyFile(filePath, destFilePath);
			return { convertedImagesCount: 0, copiedFilesCount: 1 };
		}

		if (this.path.extname(filePath) == '.svg') {
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

		return { convertedImagesCount: 1, copiedFilesCount: 0 };
	}

	async remove(entry) {
		const dest = this.getOutputPath(entry);
		await fs.rm(dest, { recursive: true, force: true });
	}

	async build(entry, options) {
		let timerStart = performance.now();
		let dest = this.getOutputPath(entry);
		const files = await fs.readdir(entry);
		await fs.mkdir(dest, { recursive: true });

		const results = await this.utils.runWithConcurrency(
			files.map(file => this.path.join(entry, file)),
			this.utils.getComponentConcurrency('images'),
			async (filePath) => {
				try {
					return await this.buildFile(filePath);
				} catch (error) {
					this.log(null, error);
					this.log('error', `Failed optimizing ${filePath.replace(this.project.path, '')} - See above error.`);
					return { convertedImagesCount: 0, copiedFilesCount: 0 };
				}
			}
		);

		const convertedImagesCount = results.reduce((sum, result) => sum + result.convertedImagesCount, 0);
		const copiedFilesCount = results.reduce((sum, result) => sum + result.copiedFilesCount, 0);

		this.end({
			itemLabel: `${dest.replace(this.project.path, '')} (${convertedImagesCount} image${convertedImagesCount == 1 ? '' : 's'}${copiedFilesCount ? `, ${copiedFilesCount} file${copiedFilesCount == 1 ? '' : 's'}` : ''})`,
			timerStart: timerStart,
			timerEnd: performance.now()
		});
	}

	async process(entry = null) {
		if (entry) {
			if (['.DS_Store', ''].includes(this.path.extname(entry)) && !entry.endsWith(this.project.paths.src.images)) {
				try {
					const directoryEntries = await fs.readdir(entry);
					if (directoryEntries) {
						await this.build(entry);
						return;
					}
				} catch (error) {
					// Fall through to file processing.
				}
			}

			await this.buildFile(entry);
			return;
		}

		await this.utils.runWithConcurrency(
			this.globsDirectories,
			Math.min(this.utils.getComponentConcurrency('images'), this.globsDirectories.length || 1),
			directory => this.build(directory)
		);
	}

	watch() {
		this.watcher = this.chokidar.watch(this.project.paths.images, {
			...this.project.chokidarOpts
		}).on('all', async (event, path) => {
			if (!this.project.isRunning) { return; }
			try {
				if (['unlink', 'unlinkDir'].includes(event)) {
					await this.remove(path);
					return;
				}

				await this.process(path);
			} catch (error) {
				this.log('error', `Failed to process images: ${error.message}`);
			}
		});
	}

}
