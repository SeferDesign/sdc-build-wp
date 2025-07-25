import BaseComponent from './base.js';
import { readdir } from 'fs/promises';
import fs from 'fs-extra';

export default class FontsComponent extends BaseComponent {

	constructor() {
		super();
		this.description = `Copy font files`;
	}

	async init() {
		this.globs = await Array.fromAsync(
			this.glob(this.project.package?.sdc?.fontsPath ||
			`${this.project.path}/${this.project.paths.src.src}/${this.project.paths.src.fonts}`)
		);
		await this.process();
	}

	async build(entry) {
		let entryLabel = `/${this.project.paths.dist}/${this.project.paths.src.fonts}`;

		this.start();

		try {
			const fontsDir = await readdir(entry);
			if (fontsDir.length == 0) { throw new Error('No files present'); }
			await fs.copy(entry, `${this.project.path}${entryLabel}`);
			entryLabel += ` (${fontsDir.filter(file => !file.startsWith('.')).length} files)`;
		} catch(error) {
			this.log('error', `${error} at ${entry.replace(this.project.path, '')}/. Skipping font copy`);
			return false;
		}

		this.end({
			itemLabel: entryLabel
		});
	}

	async process() {
		await this.build(`${this.project.path}/${this.project.paths.src.src}/${this.project.paths.src.fonts}`);
	}

	watch() {
		this.watcher = this.chokidar.watch(this.globs, {
			...this.project.chokidarOpts
		}).on('all', (event, path) => {
			if (!this.project.isRunning) { return; }
			this.process();
		});
	}

}
