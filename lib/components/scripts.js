import BaseComponent from './base.js';
import * as esbuild from 'esbuild';
import { ESLint } from 'eslint';
import * as eslintConfig from '../../eslint.config.js';

export default class ScriptsComponent extends BaseComponent {

	constructor() {
		super();
	}

	async init() {
		this.files = this.utils.addEntriesByFiletypes(['.js']);
		this.globs = await Array.fromAsync(
			this.glob(this.project.package?.sdc?.jsGlobPath ||
			`${this.project.path}/_src/scripts/**/*.js`)
		);
		await this.process();
	}

	async build(entry, options) {
		options = Object.assign({}, {
			entriesToLint: null
		}, options);
		let entryLabel = `/dist/scripts/${this.utils.entryBasename(entry).replace('.js', '.min.js')}`;

		this.start();

		try {
			const eslint = new ESLint({
				fix: true,
				overrideConfigFile: true,
				overrideConfig: eslintConfig.default[0]
			});
			const lintresults = await eslint.lintFiles(options.entriesToLint || [entry]);
			await ESLint.outputFixes(lintresults);
			const formatter = await eslint.loadFormatter('stylish');
			const formatterOutput = formatter.format(lintresults);
			if (formatterOutput) { console.log(formatterOutput.replace(this.project.path + '/_src/scripts/', '')); }
		} catch (error) {
			console.log(error);
			this.log('error', `Failed linting ${entry.replace(this.project.path + '/_src/scripts/', '')} - See above error.`);
			return false;
		}

		try {
			const result = await esbuild.build({
				platform: 'node',
				entryPoints: [entry],
				bundle: true,
				loader: { '.js': 'jsx' },
				minify: true,
				outdir: 'dist/scripts/',
				entryNames: '[dir]/[name].min',
				plugins: [],
				sourcemap: true
			});
			if (result.warnings.length > 0) {
				log('warn', result.warnings);
			}
		} catch (error) {
			this.log('error', `Failed building ${entryLabel} - See above error.`);
			return false;
		}

		this.end({
			itemLabel: entryLabel
		});
	}

	async process() {
		const promisesJS = this.files.map(block => this.build(block.file, { entriesToLint: this.globs }));
		await Promise.all(promisesJS);
	}

	watch() {
		this.chokidar.watch(this.globs, {
			...this.project.chokidarOpts
		}).on('all', (event, path) => {
			this.process();
		});
	}

}
