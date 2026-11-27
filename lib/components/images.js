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
		try {
			await fs.access(this.project.paths.images);
		} catch (error) {
			if (error.code !== 'ENOENT') { throw error; }
			this.log('info', `No images directory at ${this.path.resolve(this.project.paths.images).replace(this.project.path, '')}/. Skipping image processing`);
			this.globs = [];
			this.globsDirectories = [];
			return;
		}
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
		const sourceRoot = this.path.resolve(this.project.paths.images);
		const destRoot = `${this.project.path}/${this.project.paths.dist}/${this.project.paths.src.images}`;
		const relative = this.path.relative(sourceRoot, this.path.resolve(entry));
		// Never map a file outside the source root, or its output could overwrite the source itself.
		if (relative === '..' || relative.startsWith(`..${this.path.sep}`) || this.path.isAbsolute(relative)) {
			throw new Error(`${entry} is outside the images source directory`);
		}
		return this.path.join(destRoot, relative);
	}

	async buildFile(filePath) {
		return this.utils.withBuildSlot(() => this.processFile(filePath));
	}

	async processFile(filePath) {
		if (this.path.basename(filePath) == '.DS_Store' || !this.path.extname(filePath)) {
			return { convertedImagesCount: 0, copiedFilesCount: 0 };
		}

		const destFilePath = this.getOutputPath(filePath);
		await fs.mkdir(this.path.dirname(destFilePath), { recursive: true });

		const extension = this.path.extname(filePath).toLowerCase();
		if (!this.compressableFileFormats.includes(extension)) {
			await fs.copyFile(filePath, destFilePath);
			return { convertedImagesCount: 0, copiedFilesCount: 1 };
		}

		this.clearHashCache([filePath]);
		if (await this.shouldSkipBuild(filePath, destFilePath)) {
			return { convertedImagesCount: 1, copiedFilesCount: 0 };
		}

		if (extension == '.svg') {
			const result = optimize(await fs.readFile(filePath, 'utf8'), {
				multipass: true,
				plugins: [
					'preset-default'
				]
			});
			await fs.writeFile(destFilePath, result.data);
		} else {
			// rotate() applies EXIF orientation to the pixels, since re-encoding strips the tag.
			await sharp(filePath).rotate().toFile(destFilePath);
			const [source, output] = await Promise.all([fs.stat(filePath), fs.stat(destFilePath)]);
			if (output.size > source.size) {
				await fs.copyFile(filePath, destFilePath);
			}
		}
		await this.updateBuildCache(filePath, destFilePath);

		return { convertedImagesCount: 1, copiedFilesCount: 0 };
	}

	async remove(entry) {
		const dest = this.getOutputPath(entry);
		await fs.rm(dest, { recursive: true, force: true });
	}

	async build(entry, options) {
		let timerStart = performance.now();
		let dest = this.getOutputPath(entry);
		const files = (await fs.readdir(entry, { withFileTypes: true })).filter(file => !file.isDirectory());
		await fs.mkdir(dest, { recursive: true });

		const results = await this.utils.runWithConcurrency(
			files.map(file => this.path.join(entry, file.name)),
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
			let isDirectory = false;
			try {
				isDirectory = (await fs.stat(entry)).isDirectory();
			} catch (error) {
				// Fall through to file processing, which reports the failure.
			}
			if (isDirectory && !entry.endsWith(this.project.paths.src.images)) {
				await this.build(entry);
				return;
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
