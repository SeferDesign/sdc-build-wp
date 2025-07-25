#!/usr/bin/env node
import parseArgs from 'minimist';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import project from './lib/project.js';
import log from './lib/logging.js';
import * as utils from './lib/utils.js';
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

While watch is enabled, use the following keyboard commands to control the build process:

  [r]     Restart
  [p]     Pause/Resume
  [q]     Quit
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
	utils.stopActiveComponents();
	project.isRunning = false;
	utils.clearScreen();
	log('info', `Exited sdc-build-wp`);
	if (process.stdin.isTTY) {
		process.stdin.setRawMode(false);
		process.stdin.pause();
	}
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
			case 'p':
				project.isRunning = !project.isRunning;
				utils.clearScreen();
				if (project.isRunning) {
					log('success', 'Resumed build process');
				} else {
					log('warn', 'Paused build process');
				}
				break;
			case 'r':
				log('info', 'Restarted build process');
				utils.stopActiveComponents();
				setTimeout(() => {
					utils.clearScreen();
					runBuild();
				}, 100);
				break;
		}
	});
}

async function runBuild() {
	project.isRunning = true;
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
	utils.clearScreen();
	log('info', `Finished initial build in ${Math.round((performance.now() - initialBuildTimerStart) / 1000)} seconds`);

	if (argv.watch && project.builds.includes('server')) {
		project.builds.splice(project.builds.indexOf('server'), 1);
		project.builds.push('server');
		log('info', `Started watching [${project.builds.join(', ')}]`);
		log('info', `[r] to restart, [p] to pause/resume, [q] to quit`);
		for (let build of project.builds) {
			await project.components[build].watch();
		}
	}
}
