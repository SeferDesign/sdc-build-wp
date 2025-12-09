import BaseComponent from './base.js';
import * as prettier from 'prettier';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';

export default class HTMLComponent extends BaseComponent {

	constructor() {
		super();
		this.description = `Format html files`;
	}

	async init() {
		this.globs = await Array.fromAsync(
			this.glob(this.project.config.htmlGlobPath ||
			`${this.project.path}/**/*.html`)
		);
	}

	async build(entry, options) {
		options = Object.assign({}, {
			formatType: 'write'
		}, options);
		let entryLabel = `all html files`;

		this.start();

		let filesToFormat = this.globs;

		if (entry) {
			entryLabel = entry.replace(this.project.path, '');
			filesToFormat = [entry];
		}

		let formattedCount = 0;
		let needsFormattingCount = 0;

		try {
			for (const filePath of filesToFormat) {

				const fileContent = await fs.readFile(filePath, 'utf8');

				const prettierConfig = await prettier.resolveConfig(filePath, {
					config: this.path.resolve(this.path.dirname(fileURLToPath(import.meta.url)), '../../.prettierrc.json')
				}) || {};

				const baseConfig = {
					filepath: filePath
				};

				if (options.formatType === 'check') {
					const isFormatted = await prettier.check(fileContent, {
						...prettierConfig,
						...baseConfig
					});

					if (!isFormatted) {
						needsFormattingCount++;
					}
				} else {
					const formatted = await prettier.format(fileContent, {
						...prettierConfig,
						...baseConfig
					});
					if (formatted !== fileContent) {
						await fs.writeFile(filePath, formatted, 'utf8');
						formattedCount++;
					}
				}
			}

			if (options.formatType === 'check' && needsFormattingCount > 0) {
				this.log('warn', `${needsFormattingCount} html file${needsFormattingCount > 1 ? 's' : ''} need${needsFormattingCount === 1 ? 's' : ''} formatting`);
				return false;
			}

			if (formattedCount > 0 && !entry) {
				entryLabel = `${formattedCount} html file${formattedCount > 1 ? 's' : ''}`;
			}
		} catch (error) {
			this.log(null, error);
			this.log('error', `Failed formatting ${entryLabel.replace(this.project.path, '')} - ${error.message}`);
			return false;
		}

		if (this.project.components.server?.server) {
			this.project.components.server?.server.reload();
		}

		this.end({
			itemLabel: entryLabel,
			verb: options.formatType === 'check' ? 'Checked' : 'Formatted'
		});
	}

	async process(entry, options) {
		await this.build(entry, options);
	}

	watch() {
		this.watcher = this.chokidar.watch(this.globs, {
			...this.project.chokidarOpts,
			awaitWriteFinish: {
				stabilityThreshold: 200,
				pollInterval: 50
			}
		}).on('all', async (event, path) => {
			if (!this.project.isRunning) { return; }
			if (!['unlink', 'unlinkDir'].includes(event)) {
				try {
					await this.process(path);
				} catch (error) {
					this.log('error', `Failed to process html file ${path}: ${error.message}`);
				}
			}
		});
	}

}
