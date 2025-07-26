import path from 'path';
import * as utils from '../utils.js';
import project from '../project.js';
import log from '../logging.js';
import chokidar from 'chokidar';
import { glob } from 'node:fs/promises';

class BaseComponent {

	constructor() {
		this.description = '';
		this.timer = null;
		this.path = path;
		this.utils = utils;
		this.project = project;
		this.log = log;
		this.chokidar = chokidar;
		this.watcher = null;
		this.glob = glob;
		this.files = [];
		this.globs = [];
		this.useCache = true;
	}

	async init() {
		//
	}

	start() {
		this.timer = performance.now();
	}

	end(options) {
		options = Object.assign({}, {
			verb: 'Built',
			itemLabel: null,
			timerStart: this.timer,
			timerEnd: performance.now(),
			cached: false
		}, options);

		const cacheIndicator = options.cached ? ' (cached)' : '';
		this.log('success', `${options.verb}${options.itemLabel ? ` ${options.itemLabel}` : ''}${cacheIndicator} in ${Math.round(options.timerEnd - options.timerStart)}ms`);
	}
	async shouldSkipBuild(inputFile, outputFile, dependencies = []) {
		if (!this.useCache || !this.project.components.cache || !this.project.components.cache.manifest?.entries) {
			return false;
		}

		const needsRebuild = await this.project.components.cache.needsRebuild(
			inputFile,
			outputFile,
			dependencies
		);

		return !needsRebuild;
	}

	async updateBuildCache(inputFile, outputFile, dependencies = []) {
		if (!this.useCache || !this.project.components.cache || !this.project.components.cache.manifest?.entries) {
			return;
		}

		await this.project.components.cache.updateCache(inputFile, outputFile, dependencies);
	}

	clearHashCache(filePaths) {
		if (!this.useCache || !this.project.components.cache || !this.project.components.cache.manifest?.entries) {
			return;
		}

		this.project.components.cache.clearHashCache(filePaths);
	}

	async watch() {
		//
	}

}

export { BaseComponent as default }
