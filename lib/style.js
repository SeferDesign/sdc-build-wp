const fs = require('fs');
const path = require('path');
const project = require('./project.js');
const log = require('./logging.js');
const sass = require('sass');
const postcss = require('postcss');
const autoprefixer = require('autoprefixer');
const sortMQ = require('postcss-sort-media-queries');

const buildSass = (entry) => {
	let timerStart = Date.now();
	let outFile = project.path + '/dist/style/' + path.parse(entry).name + '.min.css';
	let entryLabel = outFile.replace(project.path, '');
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
		if (!fs.existsSync(project.path + '/dist')) {
			fs.mkdirSync(project.path + '/dist');
		}
		if (!fs.existsSync(project.path + '/dist/style')) {
			fs.mkdirSync(project.path + '/dist/style');
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
