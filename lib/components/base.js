import path from 'path';
import * as utils from '../utils.js';
import project from '../project.js';
import log from '../logging.js';
import chokidar from 'chokidar';
import { glob } from 'node:fs/promises';

class BaseComponent {

	constructor() {
		this.timer = null;
		this.path = path;
		this.utils = utils;
		this.project = project;
		this.log = log;
		this.chokidar = chokidar;
		this.glob = glob;
		this.files = [];
		this.globs = [];
	}

	async init() {
		//
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

	async watch() {
		//
	}

}

export { BaseComponent as default }
