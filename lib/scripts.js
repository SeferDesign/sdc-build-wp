const path = require('path');
const log = require('./logging.js');
const esbuild = require('esbuild');

const buildJS = async (entry) => {
	let entryLabel = `/dist/scripts/${path.parse(entry).base.replace('.js', '.min.js')}`;
	let timerStart = Date.now();
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
