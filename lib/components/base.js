import path from 'path';
import project from '../project.js';
import log from '../logging.js';
import chokidar from 'chokidar';

class BaseComponent {

	constructor() {
		this.timer = null;
		this.path = path;
		this.project = project;
		this.log = log;
		this.chokidar = chokidar;
	}

	start() {
		this.timer = Date.now();
	}

	end(options) {
		options = Object.assign({}, {
			verb: 'Built',
			itemLabel: null,
			timerStart: this.timer,
			timerEnd: Date.now()
		}, options);
		this.log('success', `${options.verb}${options.itemLabel ? ` ${options.itemLabel}` : ''} in ${options.timerEnd - options.timerStart}ms`);
	}

	entryBasename(entry) {
		return this.path.parse(entry).base;
	}

}

export { BaseComponent as default }
