import BaseComponent from './base.js';
import { stat } from 'fs/promises';
import { spawn } from 'child_process';
import process from 'process';

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

		let timerStart = Date.now();

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
		let cmds = [
			`${this.project.path}/node_modules/@wordpress/scripts/bin/wp-scripts.js`,
			`build`,
			`--source-path=.${entry.replace(this.project.path, '')}/src`,
			`--output-path=.${entry.replace(this.project.path, '')}/build`,
			`--webpack-copy-php`
		];
		await cmd(cmds, { entryLabel: entryLabel });

		this.end({
			itemLabel: entryLabel,
			timerStart: timerStart,
			timerEnd: Date.now()
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
		for (let block of this.globs) {
			this.chokidar.watch(`${block}/src`, {
				...this.project.chokidarOpts
			}).on('all', (event, path) => {
				this.process(block);
			});
		}
	}

}

function cmd(commands) {
  let p = spawn(commands[0], commands.slice(1), {
		shell: true
	});
  return new Promise((resolveFunc) => {
    p.stdout.on('data', (x) => {
			if (x.toString().includes('Error:')) {
				process.stdout.write(x.toString());
				log('error', `Failed building ${entryLabel} block - See above error.`);
			}
    });
    p.stderr.on('data', (x) => {
			if (x.toString().includes('Error:')) {
				process.stderr.write(x.toString());
				log('error', `Failed building ${entryLabel} block - See above error.`);
			}
    });
    p.on('exit', (code) => {
      resolveFunc(code);
    });
  });
}
