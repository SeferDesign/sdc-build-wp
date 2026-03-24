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
			this.log(null, error.stderr.replace(this.project.path, ''));
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

		let workingLintBin = 'phpcbf';
		if (options.lintType == 'warn') {
			workingLintBin = 'phpcs';
		}
		try {
			const cmds = [
				`php`,
				`-d`,
				`memory_limit=2G`,
				`vendor/bin/${workingLintBin}`,
				phpFiles,
			];
			let execPromise = promisify(exec);
			const { stdout, stderr } = await execPromise(cmds.join(' '), {
				cwd: this.path.resolve(this.path.dirname(fileURLToPath(import.meta.url)), '../../')
			}); // returns an error if any violations are found, so we can't rely on the try/catch as usual
		} catch (error) {
			// Filter out Time: and Memory: lines from error output
			const filterLines = str => str
				? str.split('\n').filter(line => !line.trim().startsWith('Time:') && !line.trim().startsWith('Memory:')).join('\n')
				: str;
			if (filterLines(error.stderr)?.length && error.stderr.includes('No fixable errors were found')) {
				// No fixable errors were found
			} else if (
				(filterLines(error.stderr)?.length && !error.stderr.trim().startsWith('Time:')) ||
				(
					filterLines(error.stdout)?.length &&
					(
						error.stdout.startsWith('ERROR:') ||
						error.stdout.includes('FAILED TO FIX')
					)
				)
			) {
				this.log(null, filterLines(error.stderr)?.length ? filterLines(error.stderr) : filterLines(error.stdout));
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
