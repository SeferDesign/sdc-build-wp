#!/usr/bin/env node
const fs = require('fs');
const pathConfig = require('path');
const parentPath = process.cwd();
const ourPackage = require(process.cwd() + '/package.json');
const log = require('node-pretty-log');
const sass = require('sass');
const postcss = require('postcss');
const autoprefixer = require('autoprefixer');
const sortMQ = require('postcss-sort-media-queries');

const buildSass = (entry) => {
	let timerStart = Date.now();
	log('info', `Building ${entry.replace(parentPath, '')}...`);
	let outFile = parentPath + '/dist/style/' + pathConfig.parse(entry).name + '.min.css';
	sass.render({
		file: entry,
		outFile: outFile,
		outputStyle: 'compressed'
	}, function(error, result) {
		if (!fs.existsSync(parentPath + '/dist')) {
			fs.mkdirSync(parentPath + '/dist');
		}
		if (!fs.existsSync(parentPath + '/dist/style')) {
			fs.mkdirSync(parentPath + '/dist/style');
		}
		postcss([
			autoprefixer(),
			sortMQ()
		]).process(result.css, { from: undefined }).then(resultPost => {
			fs.writeFile(outFile, resultPost.css, function(err) {
				if (err) {
					console.log(err);
				} else {
					log('success', `Built ${outFile.replace(parentPath, '')} in ${Date.now() - timerStart}ms`);
				}
			});
		});
	});
};

module.exports = buildSass;