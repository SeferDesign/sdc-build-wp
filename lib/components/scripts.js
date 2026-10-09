import BaseComponent from './base.js';
import * as esbuild from 'esbuild';
import { ESLint } from 'eslint';
import * as eslintConfig from '../../eslint.config.js';

export default class ScriptsComponent extends BaseComponent {

	constructor() {
		super();
		this.description = `Lint and process script files`;
		this.isBuilding = false;
		this.dependencyGraph = new Map();
		this.reverseDependencyGraph = new Map();
	}

	getScriptPatterns() {
		return this.project.config.scriptsGlobPath || (this.project.config.formatOnly?.scripts
			? `${this.getFormatOnlyRoot()}/**/*.{js,jsx,ts,tsx}`
			: `${this.project.path}/${this.project.paths.src.src}/${this.project.paths.src.scripts}/**/*.{js,jsx,ts,tsx}`);
	}

	async init() {
		if (!this.project.config.formatOnly?.scripts) {
			await this.discoverSourceEntries(['.js', '.jsx', '.ts', '.tsx'],
				`${this.project.path}/${this.project.paths.src.src}/${this.project.paths.src.scripts}`, this.project.paths.src.scripts);
		}
		this.setGlobPatterns(this.getScriptPatterns());
		this.globs = await Array.fromAsync(
			this.glob(this.globPatterns)
		);
		await this.process();
	}

	clearDependencyEntry(entry) {
		const existingDependencies = this.dependencyGraph.get(entry) || [];
		for (const dependency of existingDependencies) {
			const entries = this.reverseDependencyGraph.get(dependency);
			if (!entries) {
				continue;
			}

			entries.delete(entry);
			if (entries.size === 0) {
				this.reverseDependencyGraph.delete(dependency);
			}
		}

		this.dependencyGraph.delete(entry);
	}

	setDependencyEntry(entry, dependencies) {
		this.clearDependencyEntry(entry);
		this.dependencyGraph.set(entry, dependencies);

		for (const dependency of dependencies) {
			if (!this.reverseDependencyGraph.has(dependency)) {
				this.reverseDependencyGraph.set(dependency, new Set());
			}

			this.reverseDependencyGraph.get(dependency).add(entry);
		}
	}

	async rebuildDependencyGraph(entries = null) {
		const groups = entries
			? this.files.filter(group => entries.includes(group.file))
			: this.files;

		if (groups.length === 0) {
			return;
		}

		const results = await this.utils.runWithConcurrency(
			groups,
			this.utils.getComponentConcurrency('scripts'),
			async (group) => ({
				entry: group.file,
				dependencies: await this.utils.getAllJSDependencies(group.file)
			})
		);

		for (const result of results) {
			this.setDependencyEntry(result.entry, result.dependencies);
		}
	}

	getAffectedEntries(changedPath) {
		const affectedEntries = new Set();

		if (this.files.some(group => group.file === changedPath)) {
			affectedEntries.add(changedPath);
		}

		for (const entry of this.reverseDependencyGraph.get(changedPath) || []) {
			affectedEntries.add(entry);
		}

		return [...affectedEntries];
	}

	async build(entry, options) {
		return this.utils.withBuildSlot(() => this.buildEntry(entry, options));
	}

	async buildEntry(entry, options) {
		let entryLabel = `/${this.project.paths.dist}/${this.project.paths.src.scripts}/${this.utils.entryBasename(entry).replace(/\.js$|\.jsx$|\.ts$|\.tsx$/g, '.min.js')}`;
		let outFile = `${this.project.path}${entryLabel}`;

		this.start();

		let dependencies = this.dependencyGraph.get(entry);
		if (!dependencies) {
			dependencies = await this.utils.getAllJSDependencies(entry);
			this.setDependencyEntry(entry, dependencies);
		}

		this.clearHashCache([entry, ...dependencies]);

		if (await this.shouldSkipBuild(entry, outFile, dependencies)) {
			this.end({
				itemLabel: entryLabel,
				cached: true
			});
			return true;
		}

		try {
			const result = await esbuild.build({
				platform: 'browser',
				format: 'iife',
				globalName: 'sdcBuild',
				treeShaking: true,
				entryPoints: [entry],
				logLevel: 'silent',
				bundle: true,
				minify: true,
				outdir: `${this.project.paths.dist}/${this.project.paths.src.scripts}/`,
				entryNames: '[dir]/[name].min',
				loader: {
					'.js': 'jsx',
					'.jsx': 'jsx'
				},
				plugins: [],
				sourcemap: process.env.NODE_ENV == 'production' ? false : true
			});
			if (result.warnings.length > 0) {
				this.log('warn', result.warnings);
			}

			await this.updateBuildCache(entry, outFile, dependencies);
		} catch (error) {
			this.log(null, String(error.message || error.stack || error));
			this.log('error', `Failed building ${entryLabel} - See above error.`);
			return false;
		}

		this.end({
			itemLabel: entryLabel
		});
	}

	async process(entries = null, options = {}) {
		this.isBuilding = true;
		try {
			if (this.project.config.formatOnly?.scripts) {
				const lintTargets = options.lintTargets || entries || this.globs;
				if (lintTargets.length === 0) { return []; }
				const lintResult = await this.lint(lintTargets, { logSuccess: true });
				if (lintResult instanceof Error) { throw lintResult; }
				return lintResult;
			}
			const groups = entries
				? this.files.filter(group => entries.includes(group.file))
				: this.files;

			if (groups.length === 0) {
				if (options.lintTargets?.length) {
					const lintResult = await this.lint(options.lintTargets);
					if (lintResult instanceof Error) { throw lintResult; }
				}
				return [];
			}

			const lintTargets = options.lintTargets || (entries ? entries : this.globs);
			const lintResult = await this.lint(lintTargets);
			if (lintResult instanceof Error) {
				throw lintResult;
			}

			this.clearHashCache(lintTargets);
			await this.rebuildDependencyGraph(entries);

			return await this.utils.runWithConcurrency(
				groups,
				this.utils.getComponentConcurrency('scripts'),
				group => this.build(group.file)
			);
		} finally {
			this.isBuilding = false;
		}
	}

	watch() {
		this.setGlobPatterns(this.getScriptPatterns());
		this.watchGlobs(async (event, path) => {
			this.updateWatchedFiles(event, path);
			if (!this.project.config.formatOnly?.scripts) {
				this.updateSourceEntry(event, path, ['.js', '.jsx', '.ts', '.tsx'],
					`${this.project.path}/${this.project.paths.src.src}/${this.project.paths.src.scripts}`, this.project.paths.src.scripts);
			}
			if (!this.project.isRunning) { return; }
			try {
				if (this.project.config.formatOnly?.scripts) {
					if (event !== 'unlink') { await this.process([path]); }
					return;
				}
				if (['unlink', 'unlinkDir'].includes(event)) {
					await this.process();
					return;
				}

				const affectedEntries = this.getAffectedEntries(path);
				if (affectedEntries.length > 0) {
					await this.process(affectedEntries, { lintTargets: [path] });
				} else {
					await this.process(null, { lintTargets: [path] });
				}
				if (this.project.components.blocks && (path.endsWith('.js') || path.endsWith('.jsx') || path.endsWith('.ts') || path.endsWith('.tsx'))) {
					await this.checkAndRebuildAffectedBlocks(path);
				}
			} catch (error) {
				this.log(null, String(error.stack || error));
				this.log('error', `Failed to process scripts`);
			}
		});
	}

	async checkAndRebuildAffectedBlocks(changedPath) {
		if (!this.project.components.blocks || !this.project.components.blocks.globs) {
			return;
		}
		const affectedBlocks = this.project.components.blocks.getAffectedBlocks(changedPath);

		if (!affectedBlocks.size) { return; }
		await this.utils.runWithConcurrency(
			[...affectedBlocks],
			this.utils.getComponentConcurrency('blocks'),
			async (blockPath) => {
			try {
				if (this.project.components.server?.server) {
					this.project.components.server.server.notify('Building block...', 5000);
				}
				await this.project.components.blocks.process(blockPath);
			} catch (error) {
				//
			}
			}
		);
	}

	async lint(targets, { logSuccess = false } = {}) {
		const filesToLint = Array.isArray(targets) ? targets : [targets];
		if (filesToLint.length === 0) { return true; }
		const timerStart = performance.now();
		try {
			const eslint = new ESLint({
				cwd: this.project.path,
				fix: true,
				overrideConfigFile: true,
				overrideConfig: eslintConfig.default[0]
			});
			const lintresults = await this.utils.withBuildSlot(() => eslint.lintFiles(filesToLint));
			await ESLint.outputFixes(lintresults);
			const formatter = await eslint.loadFormatter('stylish');
			const formatterOutput = formatter.format(lintresults);
			if (formatterOutput) {
				const cleanedOutput = formatterOutput.replace(`${this.project.path}/${this.project.paths.src.src}/${this.project.paths.src.scripts}/`, '');
				this.log(null, cleanedOutput)
			}
			if (logSuccess && lintresults.every(result => result.errorCount === 0)) {
				this.end({
					verb: 'Formatted',
					itemLabel: filesToLint.length === 1
						? filesToLint[0].replace(this.project.path, '')
						: `${filesToLint.length} script files`,
					timerStart
				});
			}
			return true;
		} catch (error) {
			this.log(null, error.stack || error);
			return error;
		}
	}

}
