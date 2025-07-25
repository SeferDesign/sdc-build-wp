import BaseComponent from './base.js';
import fs from 'fs-extra';
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
		try {
			await fs.access(this.project.paths.errorLog);
			new Tail(this.project.paths.errorLog).on('line', function(data) {
				if (!component.project.isRunning) { return; }
				component.log('php', data);
			});
		} catch (error) {
			this.log('info', `Cannot find error log @ ${this.project.paths.errorLog}. Skipping watching php error logs`);
		}
	}

}
