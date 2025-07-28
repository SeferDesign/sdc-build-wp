import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { readFile } from 'fs/promises';
import path from 'path';
import { promises as fs } from 'fs';
import build from './build.js';
import * as utils from './utils.js';
import log from './logging.js';
import * as LibComponents from './components/index.js';
import help from './help.js';

let project = {
	config: {},
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
	images: null,
	errorLog: null
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
		`${project.path}/.sdc-build-wp/**/*`,
	]
};

export async function init() {

	if (project.package.sdc) {
		await convertPackageToConfig();
	}

	try {
		const configFile = await fs.readFile(path.join(project.path, '.sdc-build-wp', 'config.json'), 'utf-8');
		project.config = JSON.parse(configFile);
	} catch (error) {
		console.error(error);
		log('error', 'Failed to read config file.');
		process.exit(1);
	}

	project.paths.images = project.config.imagesPath || `${project.path}/${project.paths.src.src}/${project.paths.src.images}`
	project.paths.errorLog = process.env.ERROR_LOG_PATH || project.config.error_log_path || '../../../../../logs/php/error.log'
	project.entries = project.config.entries || {};

	project.argv = yargs(hideBin(process.argv)).parse();
	project.components = Object.fromEntries(Object.entries(LibComponents).map(([name, Class]) => [name, new Class()]));
	const styleDir = `${project.path}/${project.paths.src.src}/${project.paths.src.style}`;

	if (project.argv.help || project.argv.h) {
		help();
		process.exit(0);
	} else if (project.argv.version || project.argv.v) {
		console.log(await utils.getThisPackageVersion());
		process.exit(0);
	} else if (project.argv['clear-cache']) {
		if (project.components.cache) {
			try {
				await project.components.cache.init();
				await project.components.cache.clearCache();
			} catch (error) {
				console.log(`Error clearing cache: ${error.message}`);
			}
		}
		process.exit(0);
	}

	if (project.argv['no-cache']) {
		Object.values(project.components).forEach(component => {
			if (component.useCache !== undefined) {
				component.useCache = false;
			}
		});
	}

	project.builds = project.argv.builds ? (Array.isArray(project.argv.builds) ? project.argv.builds : project.argv.builds.split(',')) : Object.keys(project.components).filter(component => component !== 'cache');

	if (!project.argv['no-cache'] && !project.builds.includes('cache')) {
		project.builds.unshift('cache');
	}

	project.shouldPHPLint = typeof project.config.php === 'undefined' || typeof project.config.php.enabled === 'undefined' || project.config.php.enabled == true;

	if (Object.keys(project.entries).length === 0) {
		const styleFiles = await utils.getAllFiles(styleDir, ['.scss', '.css']);
		const jsFiles = await utils.getAllFiles(`${project.path}/${project.paths.src.src}/${project.paths.src.scripts}`, ['.js', '.ts']);
		for (const file of [...styleFiles, ...jsFiles]) {
			let thisFiletype = path.extname(file);
			let replaceString;
			if (['.scss', '.css'].includes(thisFiletype)) {
				replaceString = project.paths.src.style;
			} else if (['.js', '.ts'].includes(thisFiletype)) {
				replaceString = project.paths.src.scripts;
			}
			if (!replaceString) {
				continue;
			}
			const entryName = utils.entryBasename(file).replace(/\.(css|scss|js|ts)$/, '')
			if (!project.entries[`${replaceString}/${entryName}`]) {
				project.entries[`${replaceString}/${entryName}`] = [ file.replace(project.path, '') ];
			}
		}
	}

	process.on('unhandledRejection', (reason, promise) => {
		log('error', `Unhandled Promise Rejection: ${reason}`);
		log('warn', 'Continuing build process despite error');
	});

	process.on('uncaughtException', (error) => {
		log('error', `Uncaught Exception: ${error.message}`);
		log('warn', 'Attempting graceful shutdown');
		utils.stopActiveComponents();
		process.exit(1);
	});

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
			case '\r': // [Enter]/[Return]
				console.log('\r');
				break;
			case '\u0003': // [Ctrl]+C
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

export async function convertPackageToConfig() {
	if (!project.package.sdc) { return; }
	try {
		await fs.writeFile(path.join(project.path, '.sdc-build-wp', 'config.json'), JSON.stringify(project.package.sdc, null, '\t'));
		log('success', 'Converted package.json sdc to .sdc-build-wp/config.json');
		delete project.package.sdc;
		await fs.writeFile(path.join(project.path, 'package.json'), JSON.stringify(project.package, null, '\t'));
		log('success', 'Updated package.json to remove sdc');
	} catch (error) {
		log('error', `Failed to convert package.json sdc to .sdc-build-wp/config.json: ${error.message}`);
		process.exit(1);
	}
}

export default project;
