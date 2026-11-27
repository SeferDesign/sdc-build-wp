import BaseComponent from './base.js';
import { stat, readFile, readdir } from 'fs/promises';
import { createHash } from 'crypto';
import { createRequire } from 'module';
import webpack from 'webpack';

const cjsRequire = createRequire(import.meta.url);
const wpScriptsWebpackConfigPath = cjsRequire.resolve('@wordpress/scripts/config/webpack.config.js');
const DEFAULT_BLOCK_TIMEOUT_SECONDS = 60;

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

		// @wordpress/scripts picks its production plugins from NODE_ENV while loading, so force it
		// only for the load and restore it; other components must keep seeing the user's value.
		const originalNodeEnv = process.env.NODE_ENV;
		process.env.NODE_ENV = originalNodeEnv || 'production';
		let freshDefaultConfig, resolvedEntry;
		try {
			delete cjsRequire.cache[wpScriptsWebpackConfigPath];
			freshDefaultConfig = cjsRequire(wpScriptsWebpackConfigPath);

			// Resolve entries now, while WP_SOURCE_PATH still points at this block, rather than
			// leaving it as a lazily-invoked function shared across concurrently running compilers.
			resolvedEntry = typeof freshDefaultConfig.entry === 'function'
				? freshDefaultConfig.entry()
				: freshDefaultConfig.entry;
		} finally {
			if (originalNodeEnv === undefined) {
				delete process.env.NODE_ENV;
			} else {
				process.env.NODE_ENV = originalNodeEnv;
			}
		}

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

	// The timeout covers one block's compile only, not the time spent waiting for a build slot.
	getBuildTimeoutMS() {
		const seconds = this.project.config?.blocks?.timeout;
		return (Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_BLOCK_TIMEOUT_SECONDS) * 1000;
	}

	runWebpackConfigs(configs, timeoutMS = this.getBuildTimeoutMS()) {
		return this.utils.withBuildSlot(() => new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error(`Build timeout after ${timeoutMS / 1000} seconds`)), timeoutMS);
			webpack(configs, (err, stats) => {
				clearTimeout(timer);
				if (err) {
					reject(err);
					return;
				}
				resolve(stats);
			});
		}));
	}

	// Project files webpack actually read, excluding dependency directories.
	getCompiledProjectFiles(stats) {
		const root = `${this.project.path}${this.path.sep}`;
		return [...(stats?.compilation?.fileDependencies || [])]
			.map(file => this.normalizeProjectPath(file))
			.filter(file => file.startsWith(root) && !/[\\/](node_modules|vendor)[\\/]/.test(file));
	}

	// Shared pipeline for every block build: preflight and cache checks, in-process webpack
	// compilation with a per-block timeout, then caching of the successful builds.
	async compileBlocks(entries, { timed = false } = {}) {
		const outcomes = new Map();
		const timerStart = performance.now();
		const preflightResults = await this.utils.runWithConcurrency(
			entries,
			this.utils.getComponentConcurrency('blocks'),
			async entry => {
				const entryLabel = entry.replace(this.project.path, '');
				const workingBlockJson = `${entry}/src/block.json`;

				try {
					await stat(workingBlockJson);
				} catch (error) {
					if (await this.shouldIgnoreMissingBlockMetadata(entry)) {
						return { entry, ignored: true };
					}
					return { entry, entryLabel, missingMetadata: true };
				}

				const dependencies = await this.getBlockDependencies(entry);
				const buildOutputDir = `${entry}/build`;
				const cacheOutputFile = `${buildOutputDir}/block.json`;
				const [shouldSkip, buildExists] = await Promise.all([
					this.shouldSkipBuild(workingBlockJson, cacheOutputFile, dependencies),
					this.buildOutputExists(buildOutputDir)
				]);

				return {
					entry,
					entryLabel,
					workingBlockJson,
					dependencies,
					buildOutputDir,
					cacheOutputFile,
					cached: shouldSkip && buildExists
				};
			}
		);
		const candidates = [];

		for (const result of preflightResults) {
			if (result.ignored) {
				outcomes.set(result.entry, 'ignored');
				continue;
			}
			if (result.missingMetadata) {
				this.log('error', `Failed building ${result.entryLabel} - no block.json found.`);
				outcomes.set(result.entry, 'failed');
				continue;
			}

			this.setBlockDependencies(result.entry, result.dependencies);
			if (result.cached) {
				this.end({
					itemLabel: result.entryLabel,
					cached: true,
					...(timed ? { timerStart, timerEnd: performance.now() } : { skipTimer: true })
				});
				outcomes.set(result.entry, 'cached');
				continue;
			}

			candidates.push(result);
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
				outcomes.set(candidate.entry, 'failed');
			}
		}

		for (const { workingBlockJson, dependencies } of configs) {
			this.clearHashCache([workingBlockJson, ...dependencies]);
		}

		const compiled = await this.utils.runWithConcurrency(
			configs,
			this.utils.getComponentConcurrency('blocks'),
			async candidate => {
				try {
					return { stats: (await this.runWebpackConfigs([candidate.config])).stats[0] };
				} catch (error) {
					return { error };
				}
			}
		);

		let built = 0;
		for (const [index, candidate] of configs.entries()) {
			const { stats, error } = compiled[index];
			if (error) {
				this.log(null, error.message || error);
				this.log('error', `Failed building ${candidate.entryLabel} block - see above error.`);
				outcomes.set(candidate.entry, 'failed');
				continue;
			}
			if (stats?.hasErrors()) {
				const { errors } = stats.toJson({ errors: true, warnings: false });
				this.log(null, errors.map(error => error.message).join('\n\n'));
				this.log('error', `Failed building ${candidate.entryLabel} block - see above error.`);
				outcomes.set(candidate.entry, 'failed');
				continue;
			}

			const compiledFiles = this.getCompiledProjectFiles(stats);
			await this.updateBuildCache(candidate.workingBlockJson, candidate.cacheOutputFile, candidate.dependencies, compiledFiles);
			this.setBlockDependencies(candidate.entry, [...new Set([...candidate.dependencies, ...compiledFiles])]);
			outcomes.set(candidate.entry, 'built');
			built++;
			if (timed) {
				this.end({ itemLabel: candidate.entryLabel, timerStart, timerEnd: performance.now() });
			}
		}

		return { outcomes, attempted: configs.length, built, timerStart };
	}

	async buildAll(entries) {
		if (entries.length === 0) {
			return;
		}

		const { attempted, built, timerStart } = await this.compileBlocks(entries);
		if (attempted > 0) {
			this.log('success', `Built ${built}/${attempted} block${attempted === 1 ? '' : 's'} in ${Math.round(performance.now() - timerStart)}ms`);
		}
	}

	async shouldIgnoreMissingBlockMetadata(entry) {
		if (this.path.dirname(entry) !== this.path.join(this.project.path, 'blocks')) {
			return false;
		}

		try {
			if (!(await stat(entry)).isDirectory()) {
				return false;
			}
		} catch (error) {
			return false;
		}

		const sourceDir = this.path.join(entry, 'src');
		try {
			if (!(await stat(sourceDir)).isDirectory()) {
				return true;
			}
			return (await readdir(sourceDir)).length === 0;
		} catch (error) {
			return error.code === 'ENOENT';
		}
	}

	async build(entry) {
		this.start();
		const { outcomes } = await this.compileBlocks([entry], { timed: true });
		return ['built', 'cached'].includes(outcomes.get(entry));
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
				this.watcher.add(`${blockPath}/src`);
			}
			this.rebuildDependencyMap([blockPath]).catch(error => {
				this.log('error', `Failed to discover dependencies for new block ${blockPath}: ${error.message}`);
			});
			this.build(blockPath).catch(error => {
				this.log(null, error);
				this.log('error', `Failed initial build for new block ${blockPath}`);
			});
		}
	}

	watch() {
		const buildQueue = new Set();
		const debounceTimers = new Map();
		this.watchTimers = debounceTimers;
		const DEBOUNCE_DELAY = 500;
		this.setGlobPatterns([
			`${this.project.path}/${this.project.paths.src.src}/**/*`,
			`${this.project.path}/blocks/*/src/**/*`
		]);

		// Changes saved while a block is building are rebuilt afterwards instead of dropped.
		const pendingRebuilds = new Map();
		const scheduleBuild = (block, changedPath) => {
			clearTimeout(debounceTimers.get(block));
			debounceTimers.set(block, setTimeout(async () => {
				if (this.watcher.closed || !this.project.isRunning || !this.globs.includes(block)) {
					debounceTimers.delete(block);
					pendingRebuilds.delete(block);
					return;
				}
				if (buildQueue.has(block)) {
					debounceTimers.delete(block);
					pendingRebuilds.set(block, changedPath);
					return;
				}
				try {
					buildQueue.add(block);
					this.project.components.server?.server?.notify('Building...', 10000);
					if (changedPath.endsWith('.js')) {
						if (this.project.components.scripts && !this.project.components.scripts.isBuilding) {
							this.project.components.scripts.lint(changedPath).catch(lintError => {
								this.log(null, lintError);
								this.log('warn', `Linting failed for ${changedPath}`);
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
					if (pendingRebuilds.has(block)) {
						const pendingPath = pendingRebuilds.get(block);
						pendingRebuilds.delete(block);
						if (!this.watcher.closed && this.project.isRunning && this.globs.includes(block)) {
							scheduleBuild(block, pendingPath);
						}
					}
				}
			}, DEBOUNCE_DELAY));
		};

		this.watchGlobs(async (event, path) => {
			const relative = this.path.relative(`${this.project.path}/blocks`, path).split(this.path.sep);
			const blockPath = relative.length >= 3 && relative[1] === 'src'
				? `${this.project.path}/blocks/${relative[0]}`
				: null;
			if (event === 'unlink' && blockPath && path === `${blockPath}/src/block.json`) {
				this.globs = this.globs.filter(block => block !== blockPath);
				this.clearBlockDependencies(blockPath);
				clearTimeout(debounceTimers.get(blockPath));
				debounceTimers.delete(blockPath);
				return;
			}
			if (['unlink', 'unlinkDir'].includes(event)) {
				if (!this.project.isRunning) { return; }
				await this.rebuildDependencyMap();
				return;
			}

			if (blockPath && !this.globs.includes(blockPath)) {
				try {
					await stat(`${blockPath}/src/block.json`);
				} catch (error) {
					if (error.code === 'ENOENT') { return; }
					throw error;
				}
				this.globs.push(blockPath);
			}
			if (!this.project.isRunning) { return; }
			const directBlock = this.globs.find(blockPath => path.startsWith(`${blockPath}/src/`));

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
				scheduleBuild(block, path);
			}
		});
	}

}
