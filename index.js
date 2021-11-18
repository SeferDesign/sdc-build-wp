#!/usr/bin/env node
import path from 'path';
import project from './lib/project.js';
import parseArgs from 'minimist';
const argv = parseArgs(process.argv.slice(2));
import chokidar from 'chokidar';
import glob from 'glob';

import bustCache from './lib/bustCache.js';
import buildSass from './lib/style.js';
import buildJS from './lib/scripts.js';
import buildImages from './lib/images.js';
import buildFonts from './lib/fonts.js';
import buildBrowserSync from './lib/browsersync.js';

let chokidarOpts = {
	ignoreInitial: true
};

let sassGlobPath = project.package?.sdc?.sassGlobPath || project.path + '/_src/style/**/*.scss';
let sassGlob = glob.sync(sassGlobPath);

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

let filesSass = [];

for (const [name, files] of Object.entries(entries)) {
	files.forEach(function(file) {
		switch (path.parse(file).ext) {
			case '.scss':
				filesSass.push(file);
				break;
			case '.js':
				buildJS(file);
				bustFunctionsCache();
				if (argv.watch) {
					chokidar.watch(file, chokidarOpts).on('all', (event, path) => {
						buildJS(path);
						bustFunctionsCache();
					});
				}
				break;
		}
	});
}

filesSass.forEach((file) => {
	buildSass(file, sassGlob);
	bustFunctionsCache();
});
if (argv.watch) {
	chokidar.watch(sassGlob, chokidarOpts).on('all', (event, path) => {
		filesSass.forEach((file) => {
			buildSass(file, sassGlob);
			bustFunctionsCache();
		});
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
