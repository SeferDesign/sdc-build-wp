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
		const errorLogPaths = this.project.config.errorLogPaths;
		let errorLogPath = errorLogPaths[0];

		for (const candidatePath of errorLogPaths) {
			try {
				await fs.access(candidatePath);
				errorLogPath = candidatePath;
				break;
			} catch {
				// Try the next configured fallback.
			}
		}

		try {
			await fs.access(errorLogPath);
		} catch {
			await fs.writeFile(path.resolve(errorLogPath), '');
		}
		try {
			await fs.access(errorLogPath);
			new Tail(errorLogPath).on('line', function(data) {
				if (!component.project.isRunning) { return; }
				if (data.charAt(0) === '[' && data.charAt(25) === ']') { // remove timestamp
					data = data.substring(27);
				}
				let logVerb = 'php';
				if (data.startsWith('PHP Warning:')) {
					logVerb = 'warn';
				} else if (data.startsWith('PHP Fatal error:')) {
					logVerb = 'error';
				}
				component.log(logVerb, data);
			});
		} catch (error) {
			this.log('info', `Cannot find error log @ ${errorLogPath}. Skipping watching php error logs`);
		}
	}

}
