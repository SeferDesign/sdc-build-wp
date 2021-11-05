const path = require('path');
const project = require('./project.js');
const log = require('./logging.js');
const esbuild = require('esbuild');
const { ESLint } = require('eslint');
const eslintConfig = require('../.eslintrc.js');

const buildJS = async (entry) => {
	let entryLabel = `/dist/scripts/${path.parse(entry).base.replace('.js', '.min.js')}`;
	let timerStart = Date.now();
	try {
		const eslint = new ESLint({
			baseConfig: eslintConfig,
			fix: true
		});
		const lintresults = await eslint.lintFiles([entry]);
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
			loader: {},
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

module.exports = buildJS;
