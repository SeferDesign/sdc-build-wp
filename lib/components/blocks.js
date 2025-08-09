import { fileURLToPath } from 'url';
import BaseComponent from './base.js';
import { stat, readFile } from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';

export default class BlocksComponent extends BaseComponent {

	constructor() {
		super();
		this.description = `Process the theme's WordPress blocks`;
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
		await this.process();
	}
	async getBlockDependencies(blockPath) {
		const dependencies = [];
		const srcPath = `${blockPath}/src`;

		try {
			const srcFiles = await Array.fromAsync(
				this.glob(`${srcPath}/**/*`)
			);

			dependencies.push(...srcFiles);

			for (const file of srcFiles) {
				if (/\.(js|jsx|ts|tsx)$/.test(file)) {
					const jsDependencies = await this.utils.getAllJSDependencies(file);
					dependencies.push(...jsDependencies);
				} else if (/\.(scss|sass)$/.test(file)) {
					const scssDependencies = await this.utils.getImportedSASSFiles(file);
					dependencies.push(...scssDependencies);
				}
			}

			const uniqueDependencies = [...new Set(dependencies)];
			const existingDependencies = [];

			for (const dep of uniqueDependencies) {
				try {
					await stat(dep);
					existingDependencies.push(dep);
				} catch (error) {
					// File doesn't exist, skip it
				}
			}

			return existingDependencies;
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
			this.log('error', `Failed building ${entry} blocks - no block.json found.`);
			return false;
		}

		const dependencies = await this.getBlockDependencies(entry);
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
			console.error(error.stdout || error.stderr || error.message);
			this.log('error', `Failed building ${entryLabel} block - See above error.`);
			return false;
		}

		this.end({
			itemLabel: entryLabel,
			timerStart: timerStart,
			timerEnd: performance.now()
		});
	}

	async process(entry) {
		if (entry) {
			await this.build(entry);
		} else {
			const promisesBlocks = this.globs.map(block => this.build(block));
			await Promise.all(promisesBlocks);
		}
	}

	addBlock(blockPath) {
		if (!this.globs.includes(blockPath)) {
			this.globs.push(blockPath);
			if (this.watcher) {
				this.watcher.add([`${blockPath}/src`, `${blockPath}/src/**/*`]);
			}
			this.build(blockPath).catch(err => {
				console.error(err);
				this.log('error', `Failed initial build for new block ${blockPath}`);
			});
		}
	}

	watch() {
		const watchPaths = this.globs.map(block => `${block}/src`);
		const buildQueue = new Set();
		const debounceTimers = new Map();
		const DEBOUNCE_DELAY = 500;

		const dependencyMap = new Map();
		const updateDependencyMap = async () => {
			dependencyMap.clear();
			for (const block of this.globs) {
				try {
					const dependencies = await this.getBlockDependencies(block);
					dependencyMap.set(block, dependencies);
				} catch (error) {
					this.log('warn', `Failed to get dependencies for block ${block}: ${error.message}`);
					dependencyMap.set(block, []);
				}
			}
		};

		updateDependencyMap();
		const dependencyWatchPaths = [
			`${this.project.path}/${this.project.paths.src.src}/**/*`,
			`${this.project.path}/blocks/**/src/**/*`,
			...watchPaths
		];

		this.watcher = this.chokidar.watch(dependencyWatchPaths, {
			...this.project.chokidarOpts
		}).on('all', async (event, path) => {
			if (!this.project.isRunning) { return; }
			if (['unlink', 'unlinkDir'].includes(event)) { return; }

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

			const affectedBlocks = new Set();

			if (directBlock) {
				affectedBlocks.add(directBlock);
				try {
					const dependencies = await this.getBlockDependencies(directBlock);
					dependencyMap.set(directBlock, dependencies);
				} catch (error) {
					this.log('warn', `Failed to update dependencies for block ${directBlock}: ${error.message}`);
				}
			}
			for (const [block, dependencies] of dependencyMap) {
				if (dependencies.includes(path)) {
					affectedBlocks.add(block);
				}
			}

			if (affectedBlocks.size === 0 && !directBlock) {
				await updateDependencyMap();
				for (const [block, dependencies] of dependencyMap) {
					if (dependencies.includes(path)) {
						affectedBlocks.add(block);
					}
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
									console.error(lintError);
									this.log('warn', `Linting failed for ${path}`);
								});
							}
						}
						await this.process(block);
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
