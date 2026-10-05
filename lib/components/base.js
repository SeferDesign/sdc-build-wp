import path from 'path';
import * as utils from '../utils.js';
import project from '../project.js';
import { createComponentLogger } from '../logging.js';
import chokidar from 'chokidar';
import { glob, stat } from 'node:fs/promises';
import { statSync } from 'node:fs';

function expandBraces(pattern) {
	const match = /\{([^{}]+)\}/.exec(pattern);
	if (!match) { return [pattern]; }
	return match[1].split(',').flatMap(option =>
		expandBraces(pattern.slice(0, match.index) + option + pattern.slice(match.index + match[0].length))
	);
}

class BaseComponent {

	constructor() {
		this.description = '';
		this.timer = null;
		this.path = path;
		this.utils = utils;
		this.project = project;
		this.log = createComponentLogger(this.constructor.name.replace(/Component$/, '').toLowerCase());
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

	setGlobPatterns(patterns) {
		this.globPatterns = [patterns].flat().map(pattern => this.path.resolve(pattern));
	}

	matchesGlob(file) {
		return this.globPatterns.some(pattern => this.path.matchesGlob(file, pattern));
	}

	updateWatchedFiles(event, file) {
		if (event === 'unlink') {
			this.globs = this.globs.filter(entry => entry !== file);
		} else if (!this.globs.includes(file)) {
			this.globs.push(file);
		}
	}

	updateSourceEntry(event, file, extensions, sourceDirectory, prefix) {
		if (event === 'unlink') {
			this.files = this.files.filter(entry => entry.file !== file);
			this.clearDependencyEntry(file);
			return;
		}
		if (this.files.some(entry => entry.file === file)) { return; }
		const configured = this.utils.addEntriesByFiletypes(extensions, this.project).find(entry => entry.file === file);
		if (configured) {
			this.files.push(configured);
		} else if (
			Object.keys(this.project.config.entries || {}).length === 0 &&
			this.path.dirname(file) === sourceDirectory &&
			extensions.includes(this.path.extname(file))
		) {
			this.files.push({ file, name: `${prefix}/${this.path.parse(file).name}` });
		}
	}

	async discoverSourceEntries(extensions, sourceDirectory, prefix) {
		if (Object.keys(this.project.config.entries || {}).length > 0) {
			const entries = this.utils.addEntriesByFiletypes(extensions, this.project);
			this.files = (await Promise.all(entries.map(async entry => {
				try {
					await stat(entry.file);
					return entry;
				} catch (error) {
					if (error.code !== 'ENOENT') { throw error; }
					this.log('warn', `Configured entry ${entry.file} is missing; skipping its initial build.`);
					return null;
				}
			}))).filter(Boolean);
			return;
		}
		const entries = await Array.fromAsync(this.glob(
			extensions.map(extension => `${sourceDirectory}/*${extension}`)
		));
		this.files = entries.map(file => ({ file, name: `${prefix}/${this.path.parse(file).name}` }));
	}

	async stopWatching() {
		await this.watcher?.close();
		await this.watchPending;
		if (this.watchTimers) {
			for (const timer of this.watchTimers.values()) { clearTimeout(timer); }
			this.watchTimers.clear();
		}
	}

	watchGlobs(callback, options = {}) {
		const targets = [...new Set(this.globPatterns.flatMap(expandBraces).map(pattern => {
			const segments = pattern.split(this.path.sep);
			const globIndex = segments.findIndex(segment => /[*?[\]{}()]/.test(segment));
			return globIndex === -1
				? pattern
				: segments.slice(0, globIndex).join(this.path.sep) || this.path.parse(pattern).root;
		}))];
		const roots = [...new Set(targets.map(target => {
			let root = target;
			while (true) {
				try {
					statSync(root);
					return root;
				} catch (error) {
					if (error.code !== 'ENOENT') { throw error; }
					const parent = this.path.dirname(root);
					if (parent === root) { throw error; }
					root = parent;
				}
			}
		}))];
		this.watchPending = Promise.resolve();
		this.watcher = this.chokidar.watch(roots, {
			...this.project.chokidarOpts,
			...options,
			ignored: [
				...(this.project.chokidarOpts.ignored || []),
				...(options.ignored || []),
				(file, stats) => {
					if (stats?.isFile()) { return !this.matchesGlob(file); }
					if (stats?.isDirectory()) {
						return !targets.some(target => file === target ||
							file.startsWith(`${target}${this.path.sep}`) ||
							target.startsWith(`${file}${this.path.sep}`));
					}
					return false;
				}
			]
		}).on('all', (event, file) => {
			if (!['add', 'change', 'unlink'].includes(event) || !this.matchesGlob(file)) { return; }
			this.watchPending = this.watchPending.then(() => {
				if (!this.watcher.closed) { return callback(event, file); }
			}).catch(error => {
				this.log('error', `Failed to process watched file ${file}: ${error.message}`);
			});
			return this.watchPending;
		}).on('error', error => {
			this.log('error', `File watcher failed: ${error.message}`);
		});
		return this.watcher;
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
			skipTimer: false,
			cached: false
		}, options);

		const cacheIndicator = options.cached ? ' (cached)' : '';
		this.log('success', `${options.verb}${options.itemLabel ? ` ${options.itemLabel}` : ''}${cacheIndicator}${options.skipTimer ? '' : ` in ${Math.round(options.timerEnd - options.timerStart)}ms`}`);
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
