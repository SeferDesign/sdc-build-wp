#!/usr/bin/env node
const path = require('path');
const project = require('./lib/project.js');
const argv = require('minimist')(process.argv.slice(2));
const chokidar = require('chokidar');
const glob = require('glob');

const bustCache = require('./lib/bustCache.js');
const buildSass = require('./lib/style.js');
const buildJS = require('./lib/scripts.js');
const buildImages = require('./lib/images.js');
const buildFonts = require('./lib/fonts.js');
const buildBrowserSync = require('./lib/browsersync.js');

let chokidarOpts = {
	ignoreInitial: true
};

function bustFunctionsCache() {
	bustCache(project.path + '/functions.php');
}

function frontrunImages() {
	[project.path + '/_src/images/', project.path + '/_src/images/**/*/'].forEach((block) => {
		glob(block, {}, function(err, directory) {
			directory.forEach((dir) => {
				buildImages(dir);
			})
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
	buildSass(file);
	bustFunctionsCache();
});
if (argv.watch) {
	chokidar.watch(project.path + '/_src/style/**/*', chokidarOpts).on('all', (event, path) => {
		filesSass.forEach((file) => {
			buildSass(file);
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
