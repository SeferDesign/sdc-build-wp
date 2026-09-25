import { fileURLToPath } from 'url';
import BaseComponent from './base.js';
import { stat, readFile } from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';
import { createRequire } from 'module';
import webpack from 'webpack';

const cjsRequire = createRequire(import.meta.url);
const wpScriptsWebpackConfigPath = cjsRequire.resolve('@wordpress/scripts/config/webpack.config.js');

export default class BlocksComponent extends BaseComponent {

	constructor() {
		super();
		this.description = `Process the theme's WordPress blocks`;
		this.pendingBuilds = [];
		this.activeBuilds = 0;
		this.isFlushingQueue = false;
		this.dependencyMap = new Map();
		this.reverseDependencyMap = new Map();
	}

	async init() {
		this.globs = await Array.fromAsync(
			this.glob(`${this.project.path}/blocks/*`)
		);
		this.globsSass = await Array.fromAsync(
			this.glob(`${this.project.path}/blocks/*/src/*.scss`)
		);
		// for (var filename of this.globsSass) {
		// 	this.project.entries[`blocks/${this.path.basename(this.path.dirname(filename))}/style`] = [ filename ];
		// }
		await this.rebuildDependencyMap();
		await this.process();
	}

	clearBlockDependencies(blockPath) {
		const existingDependencies = this.dependencyMap.get(blockPath) || [];
		for (const dependency of existingDependencies) {
			const blocks = this.reverseDependencyMap.get(dependency);
			if (!blocks) {
				continue;
			}

			blocks.delete(blockPath);
			if (blocks.size === 0) {
				this.reverseDependencyMap.delete(dependency);
			}
		}

		this.dependencyMap.delete(blockPath);
	}

	setBlockDependencies(blockPath, dependencies) {
		this.clearBlockDependencies(blockPath);
		this.dependencyMap.set(blockPath, dependencies);

		for (const dependency of dependencies) {
			if (!this.reverseDependencyMap.has(dependency)) {
				this.reverseDependencyMap.set(dependency, new Set());
			}

			this.reverseDependencyMap.get(dependency).add(blockPath);
		}
	}

	async rebuildDependencyMap(blocks = null) {
		const blockPaths = blocks || this.globs;
		if (blockPaths.length === 0) {
			return;
		}

		const results = await this.utils.runWithConcurrency(
			blockPaths,
			this.utils.getComponentConcurrency('blocks'),
			async (blockPath) => ({
				blockPath,
				dependencies: await this.getBlockDependencies(blockPath)
			})
		);

		for (const result of results) {
			this.setBlockDependencies(result.blockPath, result.dependencies);
		}
	}

	getAffectedBlocks(changedPath) {
		return new Set(this.reverseDependencyMap.get(changedPath) || []);
	}
	async getBlockDependencies(blockPath) {
		const dependencies = [];
		const srcPath = `${blockPath}/src`;

		try {
			const srcFiles = await Array.fromAsync(
				this.glob(`${srcPath}/**/*`)
			);

			dependencies.push(...srcFiles);

			const nestedDependencies = await this.utils.runWithConcurrency(
				srcFiles,
				this.utils.getComponentConcurrency('blocks'),
				async (file) => {
					if (/\.(js|jsx|ts|tsx)$/.test(file)) {
						return this.utils.getAllJSDependencies(file);
					}

					if (/\.(scss|sass)$/.test(file)) {
						return this.utils.getImportedSASSFiles(file);
					}

					return [];
				}
			);
			dependencies.push(...nestedDependencies.flat());

			const uniqueDependencies = [...new Set(dependencies)];
			const existingDependencies = await this.utils.runWithConcurrency(uniqueDependencies, 8, async (dep) => {
				try {
					await stat(dep);
					return dep;
				} catch (error) {
					return null;
				}
			});

			return existingDependencies.filter(Boolean);
		} catch (error) {
			this.log('warn', `Failed to get dependencies for block ${blockPath}: ${error.message}`);
			return [];
		}
	}

	async getCurrentFileHash(filePath) {
		try {
			const content = await readFile(filePath);
			return createHash('sha256').update(content).digest('hex');
		} catch (error) {
			return null;
		}
	}

	async buildOutputExists(buildPath) {
		try {
			await stat(buildPath);
			const buildFiles = await Array.fromAsync(
				this.glob(`${buildPath}/**/*`)
			);
			return buildFiles.length > 0;
		} catch (error) {
			return false;
		}
	}

	// @wordpress/scripts reads WP_SOURCE_PATH from process.env when its webpack.config.js
	// module body executes, so the module cache must be busted per block to get a correct,
	// isolated config (source path, PHP/block.json copy patterns, etc.) for each entry.
	resolveBlockWebpackConfig(entry, buildOutputDir) {
		process.env.WP_SOURCE_PATH = `.${entry.replace(this.project.path, '')}/src`;
		process.env.WP_COPY_PHP_FILES_TO_DIST = 'true';
		process.env.NODE_ENV = process.env.NODE_ENV || 'production';

		delete cjsRequire.cache[wpScriptsWebpackConfigPath];
		const freshDefaultConfig = cjsRequire(wpScriptsWebpackConfigPath);

		// Resolve entries now, while WP_SOURCE_PATH still points at this block, rather than
		// leaving it as a lazily-invoked function shared across concurrently running compilers.
		const resolvedEntry = typeof freshDefaultConfig.entry === 'function'
			? freshDefaultConfig.entry()
			: freshDefaultConfig.entry;

		return {
			...freshDefaultConfig,
			mode: 'production',
			cache: { type: 'memory' },
			context: this.project.path,
			entry: resolvedEntry,
			output: {
				...freshDefaultConfig.output,
				path: this.path.resolve(buildOutputDir)
			}
		};
	}

	runWebpackConfigs(configs) {
		return new Promise((resolve, reject) => {
			webpack(configs, (err, stats) => {
				if (err) {
					reject(err);
					return;
				}
				resolve(stats);
			});
		});
	}

	async buildAll(entries) {
		if (entries.length === 0) {
			return;
		}

		const overallTimerStart = performance.now();
		const candidates = [];

		for (const entry of entries) {
			const entryLabel = entry.replace(this.project.path, '');
			const workingBlockJson = `${entry}/src/block.json`;

			try {
				await stat(workingBlockJson);
			} catch (error) {
				this.log('error', `Failed building ${entryLabel} - no block.json found.`);
				continue;
			}

			const dependencies = await this.getBlockDependencies(entry);
			this.setBlockDependencies(entry, dependencies);
			const buildOutputDir = `${entry}/build`;
			const cacheOutputFile = `${buildOutputDir}/index.js`;

			const shouldSkip = await this.shouldSkipBuild(workingBlockJson, cacheOutputFile, dependencies);
			const buildExists = await this.buildOutputExists(buildOutputDir);

			if (shouldSkip && buildExists) {
				this.end({
					itemLabel: entryLabel,
					cached: true,
					skipTimer: true
				});
				continue;
			}

			candidates.push({ entry, entryLabel, workingBlockJson, dependencies, buildOutputDir, cacheOutputFile });
		}

		if (candidates.length === 0) {
			return;
		}

		const configs = [];
		for (const candidate of candidates) {
			try {
				configs.push({
					...candidate,
					config: this.resolveBlockWebpackConfig(candidate.entry, candidate.buildOutputDir)
				});
			} catch (error) {
				this.log(null, error);
				this.log('error', `Failed to resolve webpack config for ${candidate.entryLabel}`);
			}
		}

		if (configs.length === 0) {
			return;
		}

		for (const { workingBlockJson, dependencies } of configs) {
			this.clearHashCache([workingBlockJson, ...dependencies]);
		}

		const timeoutMS = Math.max(60000, configs.length * 5000);
		let multiStats;
		try {
			const buildPromise = this.runWebpackConfigs(configs.map(candidate => candidate.config));
			const timeoutPromise = new Promise((_, reject) => {
				setTimeout(() => reject(new Error(`Build timeout after ${timeoutMS / 1000} seconds`)), timeoutMS);
			});
			multiStats = await Promise.race([buildPromise, timeoutPromise]);
		} catch (error) {
			this.log(null, error.message || error);
			this.log('error', `Failed building blocks - see above error.`);
			return;
		}

		const statsList = multiStats.stats || [multiStats];
		let builtCount = 0;

		for (const [index, candidate] of configs.entries()) {
			const stats = statsList[index];
			if (stats?.hasErrors()) {
				const { errors } = stats.toJson({ errors: true, warnings: false });
				this.log(null, errors.map(error => error.message).join('\n\n'));
				this.log('error', `Failed building ${candidate.entryLabel} block - see above error.`);
				continue;
			}

			await this.updateBuildCache(candidate.workingBlockJson, candidate.cacheOutputFile, candidate.dependencies);
			builtCount++;
		}

		this.log('success', `Built ${builtCount}/${configs.length} block${configs.length === 1 ? '' : 's'} in ${Math.round(performance.now() - overallTimerStart)}ms`);
	}

	async build(entry, options) {
		options = Object.assign({}, {}, options);
		let entryLabel = entry.replace(this.project.path, '');

		let timerStart = performance.now();

		this.start();

		let workingBlockJson = null;
		let potentialBlockJsonLocations = [
			`${entry}/src/block.json`,
			// `${entry}/block.json`
		];
		for (var location of potentialBlockJsonLocations) {
			try {
				await stat(location);
				workingBlockJson = location
				break;
			} catch (error) {
				//
			}
		}
		if (workingBlockJson === null) {
			this.log('error', `Failed building ${entryLabel} - no block.json found.`);
			return false;
		}

		const dependencies = await this.getBlockDependencies(entry);
		this.setBlockDependencies(entry, dependencies);
		const buildOutputDir = `${entry}/build`;
		const cacheOutputFile = `${buildOutputDir}/index.js`;

		const shouldSkip = await this.shouldSkipBuild(workingBlockJson, cacheOutputFile, dependencies);
		const buildExists = await this.buildOutputExists(buildOutputDir);

		if (shouldSkip && buildExists) {
			this.end({
				itemLabel: entryLabel,
				cached: true,
				timerStart: timerStart,
				timerEnd: performance.now()
			});
			return true;
		}

		this.clearHashCache([workingBlockJson, ...dependencies]);

		try {
			const cmds = [
				`${this.project.path}/node_modules/@wordpress/scripts/bin/wp-scripts.js`,
				`build`,
				`--source-path=.${entry.replace(this.project.path, '')}/src`,
				`--output-path=.${entry.replace(this.project.path, '')}/build`,
				`--webpack-copy-php`,
				`--config=${this.path.resolve(this.path.dirname(fileURLToPath(import.meta.url)), '../../webpack.config.js')}`,
			];
			const execPromise = promisify(exec);
			const timeoutMS = 40000;
			const buildPromise = execPromise(cmds.join(' '), {
				maxBuffer: 1024 * 1024 * 10,
				cwd: this.project.path
			});
			const timeoutPromise = new Promise((_, reject) => {
				setTimeout(() => reject(new Error(`Build timeout after ${timeoutMS / 1000} seconds`)), timeoutMS);
			});
			const { stdout, stderr } = await Promise.race([buildPromise, timeoutPromise]);
			if (stderr && stderr.trim()) {
				this.log('warn', `Build warnings for ${entryLabel}: ${stderr.trim()}`);
			}

			await this.updateBuildCache(workingBlockJson, cacheOutputFile, dependencies);
		} catch (error) {
			this.log(null, error.stdout || error.stderr || error.message);
			this.log('error', `Failed building ${entryLabel} block - See above error.`);
			return false;
		}

		this.end({
			itemLabel: entryLabel,
			timerStart: timerStart,
			timerEnd: performance.now()
		});
	}

	queueBuild(entry) {
		return new Promise((resolve, reject) => {
			this.pendingBuilds.push({ entry, resolve, reject });
			this.flushBuildQueue();
		});
	}

	flushBuildQueue() {
		if (this.isFlushingQueue) {
			return;
		}

		this.isFlushingQueue = true;

		const runNext = () => {
			const limit = this.utils.getComponentConcurrency('blocks');

			while (this.activeBuilds < limit && this.pendingBuilds.length > 0) {
				const nextBuild = this.pendingBuilds.shift();
				this.activeBuilds++;

				this.build(nextBuild.entry)
					.then(nextBuild.resolve)
					.catch(nextBuild.reject)
					.finally(() => {
						this.activeBuilds--;
						if (this.pendingBuilds.length === 0 && this.activeBuilds === 0) {
							this.isFlushingQueue = false;
							return;
						}

						runNext();
					});
			}

			if (this.pendingBuilds.length === 0 && this.activeBuilds === 0) {
				this.isFlushingQueue = false;
			}
		};

		runNext();
	}

	async process(entry) {
		if (entry) {
			await this.queueBuild(entry);
		} else {
			await this.buildAll(this.globs);
		}
	}

	addBlock(blockPath) {
		if (!this.globs.includes(blockPath)) {
			this.globs.push(blockPath);
			if (this.watcher) {
				this.watcher.add([`${blockPath}/src`, `${blockPath}/src/**/*`]);
			}
			this.rebuildDependencyMap([blockPath]).catch(() => {
				// Ignore dependency rebuild failures here; build() will surface them.
			});
			this.build(blockPath).catch(error => {
				this.log(null, error);
				this.log('error', `Failed initial build for new block ${blockPath}`);
			});
		}
	}

	watch() {
		const watchPaths = this.globs.map(block => `${block}/src`);
		const buildQueue = new Set();
		const debounceTimers = new Map();
		const DEBOUNCE_DELAY = 500;
		const dependencyWatchPaths = [
			`${this.project.path}/${this.project.paths.src.src}/**/*`,
			`${this.project.path}/blocks/**/src/**/*`,
			...watchPaths
		];

		this.watcher = this.chokidar.watch(dependencyWatchPaths, {
			...this.project.chokidarOpts
		}).on('all', async (event, path) => {
			if (!this.project.isRunning) { return; }
			if (['unlink', 'unlinkDir'].includes(event)) {
				await this.rebuildDependencyMap();
				return;
			}

			const directBlock = this.globs.find(blockPath => path.startsWith(`${blockPath}/src`));

			let contentChanged = false;
			if (this.project.components.cache) {
				const oldHash = this.project.components.cache.hashCache.get(path);
				const newHash = await this.getCurrentFileHash(path);
				if (oldHash !== newHash) {
					contentChanged = true;
					if (newHash) {
						this.project.components.cache.hashCache.set(path, newHash);
					}
				}
			} else {
				contentChanged = true;
			}
			if (!contentChanged) {
				this.end({
					itemLabel: directBlock ? directBlock.replace(this.project.path, '') : 'a block',
					cached: true,
					skipTimer: true
				});
				return;
			}

			const affectedBlocks = this.getAffectedBlocks(path);

			if (directBlock) {
				affectedBlocks.add(directBlock);
			}

			if (affectedBlocks.size === 0 && !directBlock) {
				await this.rebuildDependencyMap();
				for (const block of this.getAffectedBlocks(path)) {
					affectedBlocks.add(block);
				}
			}

			if (affectedBlocks.size > 0 && this.project.components.cache) {
				this.project.components.cache.hashCache.delete(path);
				await this.project.components.cache.invalidateFile(path);
			}

			for (const block of affectedBlocks) {
				if (debounceTimers.has(block)) {
					clearTimeout(debounceTimers.get(block));
				}
				debounceTimers.set(block, setTimeout(async () => {
					if (buildQueue.has(block)) { return; }
					try {
						buildQueue.add(block);
						this.project.components.server.server.notify('Building...', 10000);
						if (path.endsWith('.js')) {
							if (!this.project.components.scripts.isBuilding) {
								this.project.components.scripts.lint(path).catch(lintError => {
									this.log(null, lintError);
									this.log('warn', `Linting failed for ${path}`);
								});
							}
						}
						await this.process(block);
						await this.rebuildDependencyMap([block]);
					} catch (error) {
						this.log('error', `Failed to process block ${block}: ${error.message}`);
					} finally {
						buildQueue.delete(block);
						debounceTimers.delete(block);
					}
				}, DEBOUNCE_DELAY));
			}
		});
	}

}
