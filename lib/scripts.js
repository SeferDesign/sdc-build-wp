const pathConfig = require('path');
const parentPath = process.cwd();
const ourPackage = require(process.cwd() + '/package.json');
const log = require('./logging.js');
const esbuild = require('esbuild');

const buildJS = async (entry) => {
	let entryLabel = `/dist/scripts/${pathConfig.parse(entry).base.replace('.js', '.min.js')}`;
	let timerStart = Date.now();
	try {
		await esbuild.build({
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
	} catch (error) {
		log('error', `Failed building ${entryLabel} - See above error.`);
		return false;
	}
	log('success', `Built ${entryLabel} in ${Date.now() - timerStart}ms`);
};

module.exports = buildJS;
