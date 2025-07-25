#!/usr/bin/env node
import parseArgs from 'minimist';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import { default as project, init } from './lib/project.js';
import log from './lib/logging.js';
import { display as displayHelp } from './lib/help.js';
import * as utils from './lib/utils.js';

init();

const argv = parseArgs(process.argv.slice(2));

if (argv.help || argv.h) {
	displayHelp();
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
	if (project.isRunning) {
		utils.stopActiveComponents();
		project.isRunning = false;
		utils.clearScreen();
	}
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
		project.isRunning = true;
		project.builds.splice(project.builds.indexOf('server'), 1);
		project.builds.push('server');
		log('info', `Started watching [${project.builds.join(', ')}]`);
		log('info', `[r] to restart, [p] to pause/resume, [q] to quit`);
		for (let build of project.builds) {
			await project.components[build].watch();
		}
	} else {
		process.emit('SIGINT');
	}
}
