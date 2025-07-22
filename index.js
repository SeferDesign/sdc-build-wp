#!/usr/bin/env node
import parseArgs from 'minimist';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import project from './lib/project.js';
import log from './lib/logging.js';
import * as LibComponents from './lib/components/index.js';

project.components = Object.fromEntries(Object.entries(LibComponents).map(([name, Class]) => [name, new Class()]));

const argv = parseArgs(process.argv.slice(2));

if (argv.help || argv.h) {
console.log(`
Usage: sdc-build-wp [options] [arguments]

Options:
  -h, --help           Show help message and exit
  -v, --version        Version
  -w, --watch          Build and watch
  -b, --builds BUILDS  Build with specific components

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
} else if (argv.version || argv.v) {
console.log(JSON.parse(await fs.readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'package.json'))).version);
process.exit(0);
}

project.builds = argv.builds ? (Array.isArray(argv.builds) ? argv.builds : argv.builds.split(',')) : Object.keys(project.components);

(async() => {

	if (argv.watch && project.builds.includes('server')) {
		project.builds.splice(project.builds.indexOf('server'), 1);
		project.builds.unshift('server');
		project.components.server.serve(false);
	}

	let initialBuildTimerStart = performance.now();
	log('info', `Started initial build [${project.builds.join(', ')}]`);
	let promisesBuilds = [];
	for (let build of project.builds) {
		promisesBuilds.push(project.components[build].init());
	}
	await Promise.all(promisesBuilds);
	log('info', `Finished initial build in ${Math.round((performance.now() - initialBuildTimerStart) / 1000)} seconds`);

	if (argv.watch && project.builds.includes('server')) {
		project.builds.splice(project.builds.indexOf('server'), 1);
		project.builds.push('server');
		log('info', `Started watching [${project.builds.join(', ')}]`);
		for (let build of project.builds) {
			await project.components[build].watch();
		}
	}

})();

process.on('SIGINT', function() {
	console.log(`\r`);
	if (project.components.server?.server) {
		project.components.server.server.exit();
	}
	log('info', `Exiting sdc-build-wp`);
	process.exit(0);
});
