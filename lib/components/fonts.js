import BaseComponent from './base.js';
import { readdir } from 'fs/promises';
import fs from 'fs-extra';

export default class FontsComponent extends BaseComponent {

	constructor() {
		super();
	}

	async init() {
		await this.process();
	}

	async build(entry) {
		let entryLabel = `/dist/fonts`;

		this.start();

		try {
			const fontsDir = await readdir(entry);
			if (fontsDir.length == 0) { throw new Error('No files present'); }
			await fs.copy(entry, `${this.project.path}${entryLabel}`);
		} catch(error) {
			this.log('info', `${error} at ${entry.replace(this.project.path, '')}/. Skipping font copy`);
			return false;
		}

		this.end({
			itemLabel: entryLabel
		});
	}

	async process() {
		await this.build(`${this.project.path}/_src/fonts`);
	}

}
