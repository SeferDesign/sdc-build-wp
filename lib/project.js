import parseArgs from 'minimist';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';
import { promises as fs } from 'fs';
import build from './build.js';
import * as utils from './utils.js';
import log from './logging.js';
import * as LibComponents from './components/index.js';
import help from './help.js';

let project = {
	argv: null,
	isRunning: false,
	path: process.cwd(),
	package: JSON.parse(await readFile(new URL(process.cwd() + '/package.json', import.meta.url))),
	components: {},
	builds: [],
	globs: {},
	entries: {},
	files: {
		sass: [],
		js: []
	}
};

project.shouldPHPLint = typeof project.package.sdc?.php === 'undefined' || typeof project.package.sdc?.php.enabled === 'undefined' || project.package.sdc?.php.enabled == true;

project.paths = {
	src: {
		src: '_src',
		fonts: 'fonts',
		images: 'images',
		scripts: 'scripts',
		style: 'style'
	},
	dist: 'dist'
};

project.paths = {
	...project.paths,
	theme: {
		json: `${project.path}/theme.json`,
		scss: `${project.path}/${project.paths.src.src}/${project.paths.src.style}/partials/_theme.scss`
	},
	nodeModules: `${project.path}/node_modules`,
	composer: {
		vendor: `${project.path}/vendor`
	},
	images: project.package?.sdc?.imagesPath || `${project.path}/${project.paths.src.src}/${project.paths.src.images}`,
	errorLog: process.env.ERROR_LOG_PATH || project.package.sdc?.error_log_path || '../../../../../logs/php/error.log'
};

project.chokidarOpts = {
	ignoreInitial: true,
	ignored: [
		/(^|[\/\\])\.DS_Store$/,
		project.paths.nodeModules,
		`${project.paths.nodeModules}/**/*`,
		project.paths.composer.vendor,
		`${project.paths.composer.vendor}/**/*`,
		project.paths.theme.scss,
		`${project.path}/blocks/*/build/*.php`,
	]
};

export default project;

export async function init() {
	project.argv = parseArgs(process.argv.slice(2));
	project.components = Object.fromEntries(Object.entries(LibComponents).map(([name, Class]) => [name, new Class()]));

	if (project.argv.help || project.argv.h) {
		help();
		process.exit(0);
	} else if (project.argv.version || project.argv.v) {
		console.log(JSON.parse(await fs.readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '../package.json'))).version);
		process.exit(0);
	}

	project.builds = project.argv.builds ? (Array.isArray(project.argv.builds) ? project.argv.builds : project.argv.builds.split(',')) : Object.keys(project.components);

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

}

export function keypressListen() {
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
					build(true);
				}, 100);
				break;
		}
	});
}
