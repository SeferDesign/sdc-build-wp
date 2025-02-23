#!/usr/bin/env node
import path from 'path';
import project from './lib/project.js';
import parseArgs from 'minimist';
const argv = parseArgs(process.argv.slice(2));
import chokidar from 'chokidar';
import { glob, globSync } from 'glob';
import { existsSync } from 'node:fs';
import { Tail } from 'tail';

import log from './lib/logging.js';
import bustCache from './lib/bustCache.js';
import { buildSass, buildSassTheme } from './lib/style.js';
import buildJS from './lib/scripts.js';
import buildPHP from './lib/php.js';
import buildBlock from './lib/blocks.js';
import buildImages from './lib/images.js';
import buildFonts from './lib/fonts.js';
import buildBrowserSync from './lib/browsersync.js';

let chokidarOpts = {
	ignoreInitial: true,
	ignored: [
		project.path + '/node_modules',
		project.path + '/vendor',
		project.path + '/blocks/*/build/**/*'
	]
};

let shouldPHPLint = typeof project.package.sdc?.php === 'undefined' || typeof project.package.sdc?.php.enabled === 'undefined' || project.package.sdc?.php.enabled == true;
let phpGlobPath = project.package?.sdc?.phpGlobPath || project.path + '/**/*.php';
let phpGlob = globSync(phpGlobPath, {
	ignore: [
		project.path + '/node_modules',
		project.path + '/vendor'
	]
});
let sassGlobPath = project.package?.sdc?.sassGlobPath || project.path + '{/_src/style,/blocks}/**/*.scss';
let sassGlob = globSync(sassGlobPath, {
	ignore: [
		project.path + '/_src/style/partials/_theme.scss'
	]
});
let jsGlobPath = project.package?.sdc?.jsGlobPath || project.path + '/_src/scripts/**/*.js';
let jsGlob = globSync(jsGlobPath, {
	ignore: []
});
let blockGlobPath = project.package?.sdc?.blockGlobPath || project.path + '/blocks/*';
let blockGlob = globSync(blockGlobPath);

function bustFunctionsCache() {
	bustCache(project.path + '/functions.php');
}

function frontrunImages() {
	[
		project.path + '/_src/images/',
		project.path + '/_src/images/**/*/'
	].forEach((block) => {
		const imageDirectories = globSync(block);
		imageDirectories.forEach((dir) => {
			buildImages(dir);
		});
	});
}

function runBlocks() {
	for (var block of blockGlob) {
		buildBlock(block);
	}
	bustFunctionsCache();
}

function runSass() {
	buildSassTheme();
	for (var block of filesSass) {
		buildSass(block.file, block.name, sassGlob);
		bustFunctionsCache();
	}
}

function runJS() {
	for (var block of filesJS) {
		buildJS(block.file, block.name, jsGlob);
		bustFunctionsCache();
	}
}

function runPHP(file, method) {
	buildPHP(file, method);
}

let entries = {};
for (const [name, files] of Object.entries(project.package.sdc.entries)) {
	entries[name] = [];
	files.forEach(function(file) {
		entries[name].push(project.path + file);
	});
}
let sassBlocksGlob = globSync(project.path + '/blocks/*/*.scss');
for (var filename of sassBlocksGlob) {
	entries[`blocks/${path.basename(path.dirname(filename))}/style`] = [ filename ];
}

let filesSass = [];
let filesJS = [];

for (const [name, files] of Object.entries(entries)) {
	files.forEach(function(file) {
		switch (path.parse(file).ext) {
			case '.scss':
				filesSass.push({
					'name': name,
					'file': file
				});
				break;
			case '.js':
				filesJS.push({
					'name': name,
					'file': file
				});
				break;
		}
	});
}

// if (shouldPHPLint) {
// 	runPHP(null, 'warn'); // this errors "Fatal error: Allowed memory size"
// }
runBlocks();
runSass();
runJS();
frontrunImages()
buildFonts(project.path + '/_src/fonts');

if (argv.watch) {
	buildBrowserSync();
	chokidar.watch(blockGlob, chokidarOpts).on('all', (event, path) => {
		runBlocks();
	});
	chokidar.watch(sassGlob, chokidarOpts).on('all', (event, path) => {
		runSass();
	});
	chokidar.watch(project.path + '/theme.json', chokidarOpts).on('all', (event, path) => {
		runSass();
	});
	chokidar.watch(jsGlob, chokidarOpts).on('all', (event, path) => {
		runJS();
	});
	chokidar.watch(project.path + '/_src/images/**/*', chokidarOpts).on('all', (event, path) => {
		frontrunImages();
	});
	let errorLogPath = process.env.ERROR_LOG_PATH || project.package.sdc?.error_log_path || '../../../../../logs/php/error.log';
	if (existsSync(errorLogPath)) {
		let errorLogTail = new Tail(errorLogPath);
		errorLogTail.on('line', function(data) {
			log('php', data);
		});
	} else {
		log('info', `Cannot find error log @ ${errorLogPath}. Skipping watching php error logs`);
	}
	if (shouldPHPLint) {
		chokidar.watch(phpGlob, chokidarOpts).on('change', (path) => {
			runPHP(path);
		});
	}
}
