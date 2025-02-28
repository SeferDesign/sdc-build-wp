#!/usr/bin/env node
import parseArgs from 'minimist';
const argv = parseArgs(process.argv.slice(2));
import { promises as fs } from 'fs';
import { Tail } from 'tail';
import project from './lib/project.js';
import log from './lib/logging.js';
import * as LibComponents from './lib/components/index.js';

project.components = Object.fromEntries(Object.entries(LibComponents).map(([name, Class]) => [name, new Class()]));

if (argv.help || argv.h) {
console.log(`
Usage: sdc-build-wp [options] [arguments]

Options:
  -h, --help           Show help message and exit
  -w, --watch          Build and watch
  -b, --build BUILDS   Build with specific components

Components:

${Object.entries(project.components).map(([key, component]) => {
	return `${key}\t\t${component.description}\r\n`;
}).join('')}
Examples:

sdc-build-wp
sdc-build-wp --watch
sdc-build-wp --watch --builds=style,scripts
`);

process.exit(0);
}

project.builds = argv.builds ? argv.builds.split(',') : Object.keys(project.components);

(async() => {

	let initialBuildTimerStart = Date.now();
	log('info', `Starting initial build`);
	for (let build of project.builds) {
		await project.components[build].init();
	}
	log('info', `Finished initial build in ${Math.round((Date.now() - initialBuildTimerStart) / 1000)} seconds`);

	if (argv.watch) {
		for (let build of builds) {
			await project.components[build].watch();
		}
		try {
			await fs.access(project.paths.errorLog);
			let errorLogTail = new Tail(project.paths.errorLog);
			errorLogTail.on('line', function(data) {
				log('php', data);
			});
		} catch (error) {
			log('info', `Cannot find error log @ ${project.paths.errorLog}. Skipping watching php error logs`);
		}
	}

})();
