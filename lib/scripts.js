import path from 'path';
import project from '../lib/project.js';
import log from './logging.js';
import * as esbuild from 'esbuild';
import { ESLint } from 'eslint';
import * as eslintConfig from '../eslint.config.js';

const buildJS = async (entry, name, entriesToLint) => {
	let entryLabel = `/dist/scripts/${path.parse(entry).base.replace('.js', '.min.js')}`;
	let timerStart = Date.now();
	try {
		const eslint = new ESLint({
			fix: true,
			overrideConfigFile: true,
			overrideConfig: eslintConfig.default[0]
		});
		const lintresults = await eslint.lintFiles(entriesToLint || [entry]);
		await ESLint.outputFixes(lintresults);
		const formatter = await eslint.loadFormatter('stylish');
		const formatterOutput = formatter.format(lintresults);
		if (formatterOutput) { console.log(formatterOutput.replace(project.path + '/_src/scripts/', '')); }
	} catch (error) {
		console.log(error);
		log('error', `Failed linting ${entry.replace(project.path + '/_src/scripts/', '')} - See above error.`);
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
		log('error', `Failed building ${entryLabel} - See above error.`);
		return false;
	}
	log('success', `Built ${entryLabel} in ${Date.now() - timerStart}ms`);
};

export default buildJS;
