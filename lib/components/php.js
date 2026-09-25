import BaseComponent from './base.js';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import { access } from 'fs/promises';

export default class PHPComponent extends BaseComponent {

	constructor() {
		super();
		this.description = `Format and lint php files`;
	}

	isIgnoredPath(entry) {
		return /\/blocks\/[^/]+\/build\/.+\.php$/i.test(entry);
	}

	async init() {
		const allPHPFiles = await Array.fromAsync(
			this.glob(this.project.config.phpGlobPath ||
			`${this.project.path}/**/*.php`)
		);
		this.globs = allPHPFiles.filter(file => !this.isIgnoredPath(file));
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

		let phpFiles = this.globs;
		let filesToValidate = this.globs;

		if (entry) {
			if (this.isIgnoredPath(entry)) {
				return true;
			}
			entryLabel = entry.replace(this.project.path, '');
			filesToValidate = [entry];
			phpFiles = [entry];
		}

		if (filesToValidate.length === 0) {
			return true;
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

		const quoteArg = (value) => `"${String(value).replace(/"/g, '\\"')}"`;
		const configPath = this.path.resolve(this.path.dirname(fileURLToPath(import.meta.url)), '../../.php-cs-fixer.dist.php');
		const formatPaths = phpFiles.map(filePath => quoteArg(filePath));
		const fixerBinPath = this.path.resolve(this.path.dirname(fileURLToPath(import.meta.url)), '../../vendor/bin/php-cs-fixer');
		try {
			if (options.lintType === 'fix') {
				try {
					await access(fixerBinPath);
				} catch {
					this.log('warn', 'php-cs-fixer was not found in vendor/bin. Skipping PHP format pass and continuing with phpcs lint.');
					options.lintType = 'warn';
				}
			}

			if (options.lintType === 'fix') {
				const fixCmds = [
					`php`,
					`-d`,
					`memory_limit=2G`,
					`vendor/bin/php-cs-fixer`,
					`fix`,
					`--config=${quoteArg(configPath)}`,
					`--using-cache=no`,
					`--show-progress=none`,
					...formatPaths,
				];
				const execPromiseFix = promisify(exec);
				await execPromiseFix(fixCmds.join(' '), {
					cwd: this.path.resolve(this.path.dirname(fileURLToPath(import.meta.url)), '../../')
				});
			}

			const lintCmds = [
				`php`,
				`-d`,
				`memory_limit=2G`,
				`vendor/bin/phpcs`,
				...formatPaths,
			];
			const execPromiseLint = promisify(exec);
			await execPromiseLint(lintCmds.join(' '), {
				cwd: this.path.resolve(this.path.dirname(fileURLToPath(import.meta.url)), '../../')
			}); // returns an error if any violations are found, so we can't rely on the try/catch as usual
		} catch (error) {
			// Filter out Time: and Memory: lines from error output
			const filterLines = str => str
				? str.split('\n').filter(line => !line.trim().startsWith('Time:') && !line.trim().startsWith('Memory:')).join('\n').trim()
				: str;
			const filteredStderr = filterLines(error.stderr);
			const filteredStdout = filterLines(error.stdout);
			if (filteredStderr && error.stderr.includes('No fixable errors were found')) {
				// No fixable errors were found
			} else if (
				(filteredStderr && !error.stderr.trim().startsWith('Time:')) ||
				(filteredStdout && (error.stdout.startsWith('ERROR:') || error.stdout.includes('FAILED TO FIX')))
			) {
				const detail = filteredStderr || filteredStdout;
				this.log(null, detail);
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
			if (this.isIgnoredPath(path)) { return; }
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
