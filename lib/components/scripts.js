import BaseComponent from './base.js';
import * as esbuild from 'esbuild';
import { ESLint } from 'eslint';
import * as eslintConfig from '../../eslint.config.js';

export default class ScriptsComponent extends BaseComponent {

	constructor() {
		super();
		this.description = `Lint and process script files`;
		this.isBuilding = false;
	}

	async init() {
		this.files = this.utils.addEntriesByFiletypes(['.js', '.jsx', '.ts', '.tsx']);
		this.globs = await Array.fromAsync(
			this.glob(this.project.config.scriptsGlobPath ||
			`${this.project.path}/${this.project.paths.src.src}/${this.project.paths.src.scripts}/**/*.{js,jsx,ts,tsx}`)
		);
		await this.process();
	}

	async build(entry, options) {
		options = Object.assign({}, {
			entriesToLint: null
		}, options);
		let entryLabel = `/${this.project.paths.dist}/${this.project.paths.src.scripts}/${this.utils.entryBasename(entry).replace(/\.js$|\.jsx$|\.ts$|\.tsx$/g, '.min.js')}`;
		let outFile = `${this.project.path}${entryLabel}`;

		this.start();

		try {
			let thisLint = await this.lint(entry, options);
			if (thisLint instanceof Error) {
				throw thisLint;
			}
		} catch (error) {
			console.error(error);
			this.log('error', `Failed linting ${entry.replace(`${this.project.path}/${this.project.paths.src.src}/${this.project.paths.src.scripts}/`, '')} - See above error.`);
			return false;
		}

		const dependencies = await this.utils.getAllJSDependencies(entry);

		this.clearHashCache([entry, ...(options.entriesToLint || []), ...dependencies]);

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
				bundle: true,
				minify: true,
				outdir: `${this.project.paths.dist}/${this.project.paths.src.scripts}/`,
				entryNames: '[dir]/[name].min',
				plugins: [],
				sourcemap: process.env.NODE_ENV == 'production' ? false : true
			});
			if (result.warnings.length > 0) {
				this.log('warn', result.warnings);
			}

			await this.updateBuildCache(entry, outFile, dependencies);
		} catch (error) {
			console.error(error);
			this.log('error', `Failed building ${entryLabel} - See above error.`);
			return false;
		}

		this.end({
			itemLabel: entryLabel
		});
	}

	async process() {
		this.isBuilding = true;
		try {
			const promisesScripts = this.files.map((group, index) => this.build(group.file, { entriesToLint: index == 0 ? this.globs : null }));
			await Promise.all(promisesScripts);
		} finally {
			this.isBuilding = false;
		}
	}

	watch() {
		this.watcher = this.chokidar.watch(this.globs, {
			...this.project.chokidarOpts
		}).on('all', async (event, path) => {
			if (!this.project.isRunning) { return; }
			try {
				await this.process();
				if (this.project.components.blocks && (path.endsWith('.js') || path.endsWith('.jsx') || path.endsWith('.ts') || path.endsWith('.tsx'))) {
					await this.checkAndRebuildAffectedBlocks(path);
				}
			} catch (error) {
				console.error(error);
				this.log('error', `Failed to process scripts`);
			}
		});
	}

	async checkAndRebuildAffectedBlocks(changedPath) {
		if (!this.project.components.blocks || !this.project.components.blocks.globs) {
			return;
		}
		const affectedBlocks = new Set();
		for (const blockPath of this.project.components.blocks.globs) {
			try {
				const dependencies = await this.project.components.blocks.getBlockDependencies(blockPath);
				if (dependencies.includes(changedPath)) {
					affectedBlocks.add(blockPath);
				}
			} catch (error) {
				console.error(error);
			}
		}

		if (!affectedBlocks.size) { return; }
		for (const blockPath of affectedBlocks) {
			try {
				if (this.project.components.server?.server) {
					this.project.components.server.server.notify('Building block...', 5000);
				}
				await this.project.components.blocks.process(blockPath);
			} catch (error) {
				//
			}
		}
	}

	async lint(entry, options) {
		try {
			const eslint = new ESLint({
				fix: true,
				overrideConfigFile: true,
				overrideConfig: eslintConfig.default[0]
			});
			const lintresults = await eslint.lintFiles(options?.entriesToLint || [entry]);
			await ESLint.outputFixes(lintresults);
			const formatter = await eslint.loadFormatter('stylish');
			const formatterOutput = formatter.format(lintresults);
			if (formatterOutput) { console.log(formatterOutput.replace(`${this.project.path}/${this.project.paths.src.src}/${this.project.paths.src.scripts}/`, '')); }
			return true;
		} catch (error) {
			console.error(error);
			return error;
		}
	}

}
