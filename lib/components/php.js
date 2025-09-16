import BaseComponent from './base.js';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

export default class PHPComponent extends BaseComponent {

	constructor() {
		super();
		this.description = `Lint and fix php files`;
	}

	async init() {
		this.globs = await Array.fromAsync(
			this.glob(this.project.config.phpGlobPath ||
			`${this.project.path}/**/*.php`)
		);
		// await this.process(null, { lintType: 'warn' }); // this errors "Fatal error: Allowed memory size"
	}

	async checkSyntax(entry) {
		try {
			let execPromise = promisify(exec);
			const { stdout, stderr } = await execPromise(`php -l "${entry}"`, {
				cwd: this.path.resolve(this.path.dirname(fileURLToPath(import.meta.url)), '../../')
			});
		} catch (error) {
			if (error.stderr.includes('command not found')) {
				this.log('warn', 'PHP syntax checker not found. Skipping syntax check.');
				return true;
			}
			console.error(error.stderr.replace(this.project.path, ''));
			this.log('error', `Failed to validate ${entry.replace(this.project.path, '')} - See above error.`);
			return false;
		}
		return true;
	}

	async build(entry, options) {
		options = Object.assign({}, {
			lintType: 'fix'
		}, options);
		let entryLabel = `all PHP files`;

		this.start();

		let phpFiles = '.';
		let additionalFlags = '';
		let filesToValidate = this.globs;

		if (entry) {
			entryLabel = entry.replace(this.project.path, '');
			filesToValidate = [entry];
			phpFiles = entry;
		}

		let syntaxErrors = false;
		for (const phpFile of filesToValidate) {
			const syntaxValid = await this.checkSyntax(phpFile);
			if (!syntaxValid) {
				syntaxErrors = true;
			}
		}
		if (syntaxErrors) {
			return false;
		}
		try {
			const cmds = [
				`vendor/bin/mago`,
				`--workspace=${this.project.path}`,
				// `--config=${this.path.resolve(this.path.dirname(fileURLToPath(import.meta.url)), '../../mago.toml')}`,
				'format',
				phpFiles,
				additionalFlags
			];
			let execPromise = promisify(exec);
			const { stdout, stderr } = await execPromise(cmds.join(' '), {
				cwd: this.path.resolve(this.path.dirname(fileURLToPath(import.meta.url)), '../../')
			}); // returns an error if any violations are found, so we can't rely on the try/catch as usual);
		} catch (error) {
			if (
				error.stderr?.length ||
				(
					error.stdout?.length &&
					(
						error.stdout.startsWith('ERROR:') ||
						error.stdout.includes('FAILED TO FIX')
					)
				)
			) {
				console.error(error.stderr?.length ? error.stderr : error.stdout);
				this.log('error', `Failed linting ${entryLabel.replace(this.project.path, '')} - See above error.`);
				return false;
			}
		}
		if (this.project.components.server?.server) {
			this.project.components.server?.server.reload();
		}

		this.end({
			itemLabel: entryLabel,
			verb: `Linted (${options.lintType})`
		});
	}

	async process(entry, options) {
		await this.build(entry, options);
	}

	watch() {
		this.watcher = this.chokidar.watch(this.globs, {
			...this.project.chokidarOpts
		}).on('all', async (event, path) => {
			if (!this.project.isRunning) { return; }
			if (!['unlink', 'unlinkDir'].includes(event)) {
				try {
					await this.process(path);
				} catch (error) {
					this.log('error', `Failed to process PHP file ${path}: ${error.message}`);
				}
			}
		});
	}

}
