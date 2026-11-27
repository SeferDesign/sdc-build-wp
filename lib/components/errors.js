import BaseComponent from './base.js';
import path from 'path';
import { promises as fs } from 'fs';
import { Tail } from 'tail';

export default class ErrorsComponent extends BaseComponent {

	constructor() {
		super();
		this.description = `Tail error logs`;
	}

	async init() {
		//
	}

	async build() {
		//
	}

	async process() {
		//
	}

	async watch() {
		let component = this;
		const errorLogPaths = this.project.config.errorLogPaths || [];
		let errorLogPath = null;

		for (const candidatePath of errorLogPaths) {
			try {
				await fs.access(candidatePath);
				errorLogPath = candidatePath;
				break;
			} catch {
				// Try the next configured fallback.
			}
		}

		if (!errorLogPath && errorLogPaths.length > 0) {
			// Create the preferred log only when its folder exists, so tailing can begin before PHP writes to it.
			const preferredPath = path.resolve(errorLogPaths[0]);
			try {
				await fs.access(path.dirname(preferredPath));
				await fs.writeFile(preferredPath, '', { flag: 'a' });
				errorLogPath = preferredPath;
			} catch {
				// Reported below.
			}
		}

		if (!errorLogPath) {
			this.log('info', `Cannot find error log @ ${errorLogPaths[0] ?? 'a configured path'}. Skipping watching php error logs`);
			return;
		}

		try {
			const tail = new Tail(errorLogPath);
			// Registered as the watcher so restarts stop tailing instead of stacking duplicate tails.
			this.watcher = { close: async () => tail.unwatch() };
			tail.on('error', error => this.log('warn', `Error log tail failed: ${error.message}`));
			tail.on('line', function(data) {
				if (!component.project.isRunning) { return; }
				if (data.charAt(0) === '[' && data.charAt(25) === ']') { // remove timestamp
					data = data.substring(27);
				}
				let ignoredStartStrings = [
					'PHP Deprecated:',
					'objectcache.'
				]
				if (ignoredStartStrings.some(str => data.startsWith(str))) { return; }
				let logVerb = 'php';
				if (data.startsWith('PHP Warning:')) {
					logVerb = 'warn';
				} else if (data.startsWith('PHP Fatal error:')) {
					logVerb = 'error';
				}
				component.log(logVerb, data);
			});
		} catch (error) {
			this.log('info', `Cannot tail error log @ ${errorLogPath}: ${error.message}. Skipping watching php error logs`);
		}
	}

}
