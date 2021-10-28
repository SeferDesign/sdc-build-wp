#!/usr/bin/env node
const pathConfig = require('path');
const path = pathConfig.resolve(__dirname, '.');
const parentPath = process.cwd();
const ourPackage = require(process.cwd() + '/package.json');
const argv = require('minimist')(process.argv.slice(2));
const chokidar = require('chokidar');
const glob = require('glob');

const bustCache = require(path + '/lib/bustCache.js');
const buildSass = require(path + '/lib/style.js');
const buildJS = require(path + '/lib/scripts.js');
const buildImages = require(path + '/lib/images.js');
const buildFonts = require(path + '/lib/fonts.js');
const buildBrowserSync = require(path + '/lib/browsersync.js');

let chokidarOpts = {
	ignoreInitial: true
};

function bustFunctionsCache() {
	bustCache(parentPath + '/functions.php');
}

function frontrunImages() {
	[parentPath + '/_src/images/', parentPath + '/_src/images/**/*/'].forEach((block) => {
		glob(block, {}, function(err, directory) {
			directory.forEach((dir) => {
				buildImages(dir);
			})
		});
	});
}

let entries = {};
for (const [name, files] of Object.entries(ourPackage.sdc.entries)) {
	entries[name] = [];
	files.forEach(function(file) {
		entries[name].push(parentPath + file);
	});
}

let filesSass = [];

for (const [name, files] of Object.entries(entries)) {
	files.forEach(function(file) {
		switch (pathConfig.parse(file).ext) {
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
	chokidar.watch(parentPath + '/_src/style/**/*', chokidarOpts).on('all', (event, path) => {
		filesSass.forEach((file) => {
			buildSass(file);
			bustFunctionsCache();
		});
	});
}
frontrunImages()
if (argv.watch) {
	chokidar.watch(parentPath + '/_src/images/**/*', chokidarOpts).on('all', (event, path) => {
		frontrunImages();
	});
}

buildFonts(parentPath + '/_src/fonts');

if (argv.watch) {
	buildBrowserSync();
}
