#!/usr/bin/env node
import path from 'path';
import project from './lib/project.js';
import parseArgs from 'minimist';
const argv = parseArgs(process.argv.slice(2));
import chokidar from 'chokidar';
import glob from 'glob';

import bustCache from './lib/bustCache.js';
import { buildSass, buildSassTheme } from './lib/style.js';
import buildJS from './lib/scripts.js';
import buildBlock from './lib/blocks.js';
import buildImages from './lib/images.js';
import buildFonts from './lib/fonts.js';
import buildBrowserSync from './lib/browsersync.js';

let chokidarOpts = {
	ignoreInitial: true,
	ignored: [
		project.path + '/blocks/*/build/**/*'
	]
};

let sassGlobPath = project.package?.sdc?.sassGlobPath || project.path + '{/_src/style,/blocks}/**/*.scss';
let sassGlob = glob.sync(sassGlobPath, {
	ignore: [
		project.path + '/_src/style/partials/_theme.scss'
	]
});
let jsGlobPath = project.package?.sdc?.jsGlobPath || project.path + '/_src/scripts/**/*.js';
let jsGlob = glob.sync(jsGlobPath, {
	ignore: []
});
let blockGlobPath = project.package?.sdc?.blockGlobPath || project.path + '/blocks/*';
let blockGlob = glob.sync(blockGlobPath);

function bustFunctionsCache() {
	bustCache(project.path + '/functions.php');
}

function frontrunImages() {
	[project.path + '/_src/images/', project.path + '/_src/images/**/*/'].forEach((block) => {
		glob(block, {}, function(err, directory) {
			directory.forEach((dir) => {
				buildImages(dir);
			});
		});
	});
}

let entries = {};
for (const [name, files] of Object.entries(project.package.sdc.entries)) {
	entries[name] = [];
	files.forEach(function(file) {
		entries[name].push(project.path + file);
	});
}
let sassBlocksGlob = glob.sync(project.path + '/blocks/*/*.scss');
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

function runBlocks() {
	for (var block of blockGlob) {
		buildBlock(block);
	}
	bustFunctionsCache();
}

runBlocks();
if (argv.watch) {
	chokidar.watch(blockGlob, chokidarOpts).on('all', (event, path) => {
		runBlocks();
	});
}

function runSass() {
	buildSassTheme();
	for (var block of filesSass) {
		buildSass(block.file, block.name, sassGlob);
		bustFunctionsCache();
	}
}

runSass();
if (argv.watch) {
	chokidar.watch(sassGlob, chokidarOpts).on('all', (event, path) => {
		runSass();
	});
}

function runJS() {
	for (var block of filesJS) {
		buildJS(block.file, block.name, jsGlob);
		bustFunctionsCache();
	}
}

runJS();
if (argv.watch) {
	chokidar.watch(jsGlob, chokidarOpts).on('all', (event, path) => {
		runJS();
	});
}

if (argv.watch) {
	chokidar.watch(project.path + '/theme.json', chokidarOpts).on('all', (event, path) => {
		runSass();
	});
}

frontrunImages()
if (argv.watch) {
	chokidar.watch(project.path + '/_src/images/**/*', chokidarOpts).on('all', (event, path) => {
		frontrunImages();
	});
}

buildFonts(project.path + '/_src/fonts');

if (argv.watch) {
	buildBrowserSync();
}
