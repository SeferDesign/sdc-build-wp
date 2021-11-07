import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import project from '../lib/project.js';
import log from './logging.js';
import sass from 'sass';
import postcss from 'postcss';
import autoprefixer from 'autoprefixer';
import sortMQ from 'postcss-sort-media-queries';
import stylelint from 'stylelint';

const buildSass = (entry) => {
	let timerStart = Date.now();
	let outFile = project.path + '/dist/style/' + path.parse(entry).name + '.min.css';
	let entryLabel = outFile.replace(project.path, '');
	stylelint.lint({
		configFile: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.stylelintrc'),
		formatter: 'string',
		files: [entry],
		customSyntax: 'postcss-scss',
		fix: true
	}).then((data) => {
		if (data.errored) {
			console.log(data.output);
			log('error', `Failed linting ${entry.replace(project.path + '/_src/style/', '')} - See above error.`);
			return false;
		}
		sass.render({
			file: entry,
			outFile: outFile,
			outputStyle: 'compressed'
		}, function(error, result) {
			if (error) {
				console.log(error.formatted);
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
						log('error', `Failed saving ${entryLabel} - See above error.`);
						return false;
					} else {
						log('success', `Built ${entryLabel} in ${Date.now() - timerStart}ms`);
					}
				});
			});
		});
	});

};

export default buildSass;
