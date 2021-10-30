const fs = require('fs');
const pathConfig = require('path');
const parentPath = process.cwd();
const ourPackage = require(process.cwd() + '/package.json');
const log = require('./logging.js');
const sass = require('sass');
const postcss = require('postcss');
const autoprefixer = require('autoprefixer');
const sortMQ = require('postcss-sort-media-queries');

const buildSass = (entry) => {
	let timerStart = Date.now();
	let outFile = parentPath + '/dist/style/' + pathConfig.parse(entry).name + '.min.css';
	let entryLabel = outFile.replace(parentPath, '');
	sass.render({
		file: entry,
		outFile: outFile,
		outputStyle: 'compressed'
	}, function(error, result) {
		if (error) {
			console.log(error);
			log('error', `Failed building ${entryLabel} - See above error.`);
			return false;
		}
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
					log('success', `Built ${entryLabel} in ${Date.now() - timerStart}ms`);
				}
			});
		});
	});
};

module.exports = buildSass;
