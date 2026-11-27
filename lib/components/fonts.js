import BaseComponent from './base.js';
import { readdir } from 'fs/promises';
import { promises as fs } from 'fs';

export default class FontsComponent extends BaseComponent {

	constructor() {
		super();
		this.description = `Copy font files`;
	}

	async init() {
		this.sourceDirectory = this.path.resolve(this.project.config.fontsPath ||
			`${this.project.path}/${this.project.paths.src.src}/${this.project.paths.src.fonts}`);
		this.globs = [this.sourceDirectory];
		try {
			await fs.access(this.sourceDirectory);
		} catch (error) {
			if (error.code !== 'ENOENT') { throw error; }
			this.log('info', `No fonts directory at ${this.sourceDirectory.replace(this.project.path, '')}/. Skipping font copy`);
			return;
		}
		await this.process();
	}

	async removeStaleFonts(source, destination) {
		const expected = new Set((await readdir(source, { recursive: true })).map(file => this.path.normalize(file)));
		for (const file of await readdir(destination, { recursive: true, withFileTypes: true })) {
			if (file.isDirectory()) { continue; }
			const relative = this.path.relative(destination, this.path.join(file.parentPath, file.name));
			if (!expected.has(relative)) {
				await fs.rm(this.path.join(destination, relative), { force: true });
			}
		}
	}

	async build(entry) {
		let entryLabel = `/${this.project.paths.dist}/${this.project.paths.src.fonts}`;

		this.start();

		try {
			const fontsDir = await readdir(entry);
			if (fontsDir.length == 0) { throw new Error('No files present'); }
			const destination = `${this.project.path}${entryLabel}`;
			await this.utils.withBuildSlot(async () => {
				await fs.cp(entry, destination, {
					recursive: true,
					filter: source => this.path.basename(source) !== '.DS_Store'
				});
				await this.removeStaleFonts(entry, destination);
			});
			entryLabel += ` (${fontsDir.filter(file => !file.startsWith('.')).length} files)`;
		} catch (error) {
			this.log('error', `${error} at ${entry.replace(this.project.path, '')}/. Skipping font copy`);
			return false;
		}

		this.end({
			itemLabel: entryLabel
		});
	}

	async process() {
		await this.build(this.sourceDirectory);
	}

	watch() {
		this.sourceDirectory = this.sourceDirectory || this.path.resolve(
			this.project.config.fontsPath ||
			`${this.project.path}/${this.project.paths.src.src}/${this.project.paths.src.fonts}`);
		this.setGlobPatterns(`${this.sourceDirectory}/**/*`);
		this.watchGlobs(async () => {
			if (!this.project.isRunning) { return; }
			try {
				await this.process();
			} catch (error) {
				this.log('error', `Failed to process fonts: ${error.message}`);
			}
		});
	}

}
