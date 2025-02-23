import path from 'path';
import { fileURLToPath } from 'url';
import project from '../lib/project.js';
import log from './logging.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { browserSync } from './browsersync.js';

const execPromise = promisify(exec);

export const shouldPHPLint = typeof project.package.sdc?.php === 'undefined' || typeof project.package.sdc?.php.enabled === 'undefined' || project.package.sdc?.php.enabled == true

let workingLintMethod = typeof project.package.sdc?.php?.fix !== 'undefined' && project.package.sdc?.php?.fix === false ? 'warn' : 'fix';

const buildPHP = async (entry, method) => {
	if (method) {
		workingLintMethod = method;
	}
	let workingLintBin = 'phpcbf';
	if (workingLintMethod == 'warn') {
		workingLintBin = 'phpcs';
	}
	let timerStart = Date.now();
	let phpFiles = '.';
	let additionalFlags = '';
	let entryLabel = 'all PHP files';
	if (entry) {
		phpFiles = entry;
		entryLabel = entry;
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
			`--basepath=${project.path}`,
			phpFiles,
			additionalFlags
		];
		const { stdout, stderr } = await execPromise(cmds.join(' '), {
			cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../')
		}); // returns an error if any violations are found, so we can't rely on the try/catch as usual
		log('success', `Linted (${workingLintMethod}) ${entryLabel.replace(project.path, '')} in ${Date.now() - timerStart}ms`);
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
			log('error', `Failed linting ${entryLabel.replace(project.path, '')} - See above error.`);
		} else {
			if (error.stdout?.length) {
				console.log(error.stdout);
			}
			log('success', `Linted (${workingLintMethod}) ${entryLabel.replace(project.path, '')} in ${Date.now() - timerStart}ms`);
		}
	}
	browserSync.reload();
};

export default buildPHP;
