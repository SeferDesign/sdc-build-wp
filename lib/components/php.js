import BaseComponent from './base.js';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

class PHPComponent extends BaseComponent {

	constructor() {
		super();
		this.slug = 'php';
		this.execPromise = promisify(exec);
	}

	async init() {
		this.globs = await Array.fromAsync(
			this.glob(this.project.package?.sdc?.phpGlobPath ||
			`${this.project.path}/**/*.php`)
		);
		this.globsBlocks = await Array.fromAsync(
			this.glob(`${this.project.path}/blocks/*/build/*.php`)
		);
		this.project.chokidarOpts.ignored = [
			...this.project.chokidarOpts.ignored,
			...this.globsBlocks
		];
		// await this.process(null, { lintType: 'warn' }); // this errors "Fatal error: Allowed memory size"
	}

	async build(entry, options) {
		options = Object.assign({}, {
			lintType: 'fix'
		}, options);
		let entryLabel = `all PHP files`;

		this.start();
		let workingLintBin = 'phpcbf';
		if (options.lintType == 'warn') {
			workingLintBin = 'phpcs';
		}
		let phpFiles = '.';
		let additionalFlags = '';
		if (entry) {
			phpFiles = entry;
			entryLabel = entry.replace(this.project.path, '');
		} else {
			additionalFlags += ' -d memory_limit=2G'; // FIXME: this doesn't solve error issue "Fatal error: Allowed memory size"
		}
		try {
			const cmds = [
				`vendor/bin/${workingLintBin}`,
				`--parallel=5`,
				`--error-severity=1`,
				`--warning-severity=1`,
				`--colors`,
				`--basepath=${this.project.path}`,
				phpFiles,
				additionalFlags
			];

			const { stdout, stderr } = await this.execPromise(cmds.join(' '), {
				cwd: this.path.resolve(this.path.dirname(fileURLToPath(import.meta.url)), '../../')
			}); // returns an error if any violations are found, so we can't rely on the try/catch as usual
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
			} else {
				if (error.stdout?.length) {
					console.log(error.stdout);
				}
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
		this.chokidar.watch(this.globs, {
			...this.project.chokidarOpts
		}).on('all', (event, path) => {
			this.process(path);
		});
	}

}

export { PHPComponent as default }
