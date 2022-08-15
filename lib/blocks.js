import path from 'path';
import project from '../lib/project.js';
import log from './logging.js';
import esbuild from 'esbuild';
import { ESLint } from 'eslint';
import { readFile } from 'fs/promises';

const buildBlocks = async (entries) => {
	let timerStart = Date.now();
	try {
		const eslint = new ESLint({
			baseConfig: JSON.parse(await readFile(new URL('../.eslintrc', import.meta.url))),
			fix: true
		});
		const lintresults = await eslint.lintFiles(entries);
		await ESLint.outputFixes(lintresults);
		const formatter = await eslint.loadFormatter('stylish');
		const formatterOutput = formatter.format(lintresults);
		if (formatterOutput) { console.log(formatterOutput.replace(project.path + '/_src/blocks/', '')); }
	} catch (error) {
		console.log(error);
		log('error', `Failed linting ${entries.length} blocks - See above error.`);
		return false;
	}
	try {
		const result = await esbuild.build({
			platform: 'node',
			entryPoints: entries,
			bundle: true,
			loader: { '.js' : 'jsx' },
			minify: true,
			outdir: 'dist/blocks/',
			entryNames: '[dir]/[name].min',
			plugins: [],
			sourcemap: true
		});
		if (result.warnings.length > 0) {
			log('warn', result.warnings);
		}
	} catch (error) {
		log('error', `Failed building ${entries.length} blocks - See above error.`);
		return false;
	}
	log('success', `Built ${entries.length} blocks in ${Date.now() - timerStart}ms`);
};

export default buildBlocks;
