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

(async () => {
	keypressListen();
	await runBuild();
})();

process.on('SIGINT', function () {
	console.log(`\r`);
	if (process.stdin.isTTY) {
		process.stdin.setRawMode(false);
		process.stdin.pause();
	}
	stopActiveComponents()
	log('info', `Exiting sdc-build-wp`);
	process.exit(0);
});

function keypressListen() {
	if (!process.stdin.isTTY) { return; }

	process.stdin.setRawMode(true);
	process.stdin.resume();
	process.stdin.setEncoding('utf8');

	process.stdin.on('data', (key) => {
		switch (key) {
			case '\u0003': // Ctrl+C
			case 'q':
				process.emit('SIGINT');
				return;
			case 'r':
				log('info', 'Restart requested...');
				stopActiveComponents()
				setTimeout(() => {
					process.stdout.write('\x1B[2J\x1B[0f'); // Clear screen
					runBuild();
				}, 100);
				break;
		}
	});
}

async function runBuild() {
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
		log('info', `[r] to restart, [q] to quit`);
		for (let build of project.builds) {
			await project.components[build].watch();
		}
	}
}

function stopActiveComponents() {
	if (project.components.server?.server) {
		project.components.server.server.exit();
	}
}
