const pathConfig = require('path');
const parentPath = process.cwd();
const ourPackage = require(process.cwd() + '/package.json');
const log = require('node-pretty-log');
const esbuild = require('esbuild');

const buildJS = async (entry) => {
	let timerStart = Date.now();
	log('info', `Building ${entry.replace(parentPath, '')}...`);
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
	log('success', `Built /dist/scripts/${pathConfig.parse(entry).base.replace('.js', '.min.js')} in ${Date.now() - timerStart}ms`);
};

module.exports = buildJS;