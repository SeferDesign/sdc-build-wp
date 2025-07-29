import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { readFile } from 'fs/promises';
import path from 'path';
import { promises as fs } from 'fs';
import chokidar from 'chokidar';
import { restartBuild } from './build.js';
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

const configPath = path.join(project.path, '.sdc-build-wp', 'config.json');

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
		`${project.path}/.sdc-build-wp/cache/**/*`,
	]
};

export async function init() {

	project.argv = yargs(hideBin(process.argv))
		.help(false)
		.argv;

	if (project.argv.help || project.argv.h) {
		help();
		process.exit(0);
	}

	if (project.package.sdc) {
		await convertPackageToConfig();
	}

	await loadConfig();

	project.components = Object.fromEntries(Object.entries(LibComponents).map(([name, Class]) => [name, new Class()]));
	const styleDir = `${project.path}/${project.paths.src.src}/${project.paths.src.style}`;

	if (project.argv.version || project.argv.v) {
		console.log(await utils.getThisPackageVersion());
		process.exit(0);
	} else if (project.argv['clear-cache']) {
		if (project.components.cache) {
			try {
				await project.components.cache.init();
				await project.components.cache.clearCache();
			} catch (error) {
				console.error(error);
				log('error', `Failed to clear cache`);
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

	process.on('SIGINT', async function() {
		console.log(`\r`);
		if (project.isRunning) {
			utils.stopActiveComponents();
			project.isRunning = false;
			utils.clearScreen();
		}
		if (project.configWatcher) {
			await project.configWatcher.close();
			project.configWatcher = null;
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
				restartBuild();
				break;
		}
	});
}

export async function convertPackageToConfig() {
	if (!project.package.sdc) { return; }
	try {
		await fs.writeFile(configPath, JSON.stringify(project.package.sdc, null, '\t'));
		log('success', 'Converted package.json sdc to .sdc-build-wp/config.json');
		delete project.package.sdc;
		await fs.writeFile(path.join(project.path, 'package.json'), JSON.stringify(project.package, null, '\t'));
		log('success', 'Updated package.json to remove sdc');
	} catch (error) {
		log('error', `Failed to convert package.json sdc to .sdc-build-wp/config.json: ${error.message}`);
		process.exit(1);
	}
}

export async function loadConfig() {
	try {
		const configFile = await fs.readFile(configPath, 'utf-8');
		project.config = JSON.parse(configFile);
		project.paths.images = project.config.imagesPath || `${project.path}/${project.paths.src.src}/${project.paths.src.images}`
		project.paths.errorLog = process.env.ERROR_LOG_PATH || project.config.error_log_path || '../../../../../logs/php/error.log'
		project.entries = project.config.entries || {};
		project.shouldPHPLint = typeof project.config.php === 'undefined' || typeof project.config.php.enabled === 'undefined' || project.config.php.enabled == true;
		setupConfigWatcher();
	} catch (error) {
		console.error(error);
		log('error', `Failed to load config`);
		process.exit(1);
	}
}

export function setupConfigWatcher() {
	if (!project.argv.watch) { return; }
	const configWatcher = chokidar.watch(configPath, {
		ignoreInitial: true,
		persistent: true
	});
	configWatcher.on('change', async () => {
		if (!project.isRunning) { return; }
		await loadConfig();
		restartBuild();
	});
	configWatcher.on('error', (error) => {
		console.error(error);
		log('warn', `Config file watcher error`);
	});
	project.configWatcher = configWatcher;
}

export default project;
