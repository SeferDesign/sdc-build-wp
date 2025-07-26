import { fileURLToPath } from 'url';
import BaseComponent from './base.js';
import { stat } from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';

export default class BlocksComponent extends BaseComponent {

	constructor() {
		super();
		this.description = `Process the theme's WordPress blocks`;
	}

	async init() {
		this.globs = await Array.fromAsync(
			this.glob(`${this.project.path}/blocks/*`)
		);
		this.globsSass = await Array.fromAsync(
			this.glob(`${this.project.path}/blocks/*/src/*.scss`)
		);
		// for (var filename of this.globsSass) {
		// 	this.project.entries[`blocks/${this.path.basename(this.path.dirname(filename))}/style`] = [ filename ];
		// }
		await this.process();
	}

	async build(entry, options) {
		options = Object.assign({}, {}, options);
		let entryLabel = entry.replace(this.project.path, '');

		let timerStart = performance.now();

		this.start();

		let workingBlockJson = null;
		let potentialBlockJsonLocations = [
			`${entry}/src/block.json`,
			// `${entry}/block.json`
		];
		for (var location of potentialBlockJsonLocations) {
			try {
				await stat(location);
				workingBlockJson = location
				break;
			} catch (error) {
				//
			}
		}
		if (workingBlockJson === null) {
			this.log('error', `Failed building ${entry} blocks - no block.json found.`);
			return false;
		}
		try {
			const cmds = [
				`${this.project.path}/node_modules/@wordpress/scripts/bin/wp-scripts.js`,
				`build`,
				`--source-path=.${entry.replace(this.project.path, '')}/src`,
				`--output-path=.${entry.replace(this.project.path, '')}/build`,
				`--webpack-copy-php`,
				`--config=${this.path.resolve(this.path.dirname(fileURLToPath(import.meta.url)), '../../webpack.config.js')}`,
			];
			let execPromise = promisify(exec);
			const { stdout, stderr } = await execPromise(cmds.join(' '));
		} catch (error) {
			console.log(error.stdout || error);
			this.log('error', `Failed building ${entryLabel} block - See above error.`);
			return false;
		}

		this.end({
			itemLabel: entryLabel,
			timerStart: timerStart,
			timerEnd: performance.now()
		});
	}

	async process(entry) {
		if (entry) {
			await this.build(entry);
		} else {
			const promisesBlocks = this.globs.map(block => this.build(block));
			await Promise.all(promisesBlocks);
		}
	}

	watch() {
		const watchPaths = this.globs.map(block => `${block}/src`);
		const buildQueue = new Set();
		this.watcher = this.chokidar.watch(watchPaths, {
			...this.project.chokidarOpts
		}).on('all', async (event, path) => {
			if (!this.project.isRunning) { return; }
			if (['unlink', 'unlinkDir'].includes(event)) { return; }
			const block = this.globs.find(blockPath => path.startsWith(`${blockPath}/src`));
			if (!block || buildQueue.has(block)) { return; }
			try {
				buildQueue.add(block);
				if (path.endsWith('.js')) {
					this.project.components.scripts.lint(path);
				}
				await this.process(block);
			} catch (error) {
				this.log('error', `Failed to process block ${block}: ${error.message}`);
			} finally {
				buildQueue.delete(block);
			}
		});
	}

}
