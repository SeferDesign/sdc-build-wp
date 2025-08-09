import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { readFile } from 'fs/promises';
import path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import chokidar from 'chokidar';
import { restartBuild } from './build.js';
import * as utils from './utils.js';
import log from './logging.js';
import * as LibComponents from './components/index.js';
import help from './help.js';
import { validateConfig, mergeWithDefaults } from './config-validator.js';
import { input, select } from '@inquirer/prompts';

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

	project.components = Object.fromEntries(Object.entries(LibComponents).map(([name, Class]) => [name, new Class()]));

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

	const styleDir = `${project.path}/${project.paths.src.src}/${project.paths.src.style}`;

	if (project.argv.version || project.argv.v) {
		console.log(await utils.getThisPackageVersion());
		process.exit(0);
	} else if (project.argv['clear-cache']) {
		try {
			await project.components.cache.init();
			await project.components.cache.clearCache();
		} catch (error) {
			console.error(error);
			log('error', `Failed to clear cache`);
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
		project.builds = ['cache', ...project.builds];
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

	process.on('uncaughtException', async (error) => {
		log('error', `Uncaught Exception: ${error.message}`);
		log('warn', 'Attempting graceful shutdown');
		await utils.stopActiveComponents();
		process.exit(1);
	});

	process.on('SIGINT', async function() {
		console.log(`\r`);
		if (project.isRunning) {
			await utils.stopActiveComponents();
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

	let isPrompting = false;

	const installRaw = () => {
		if (!process.stdin.isTTY) return;
		try { process.stdin.setRawMode(true); } catch {}
		process.stdin.resume();
		process.stdin.setEncoding('utf8');
	};

	installRaw();

	const handler = async (key) => {
		if (isPrompting) { return; }
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
			case 'c':
				await project.components.cache.clearCache();
				break;
			case 'r':
				log('info', 'Restarted build process');
				await restartBuild();
				break;
			case 'n': // New menu
				isPrompting = true;
				process.stdin.removeListener('data', handler);
				try {
					try { process.stdin.setRawMode(false); } catch {}
					await handleCreateNew();
				} finally {
					isPrompting = false;
					installRaw();
					process.stdin.on('data', handler);
				}
				break;
		}
	};

	process.stdin.on('data', handler);
}

async function handleCreateNew() {
	if (!project.isRunning) {
		log('warn', 'Build process paused. Press [p] to resume if needed. Continuing creation.');
	}
	let typeKey;
	try {
		typeKey = await select({
			message: 'Create new:',
			choices: [
				{ name: 'Block', value: 'b' },
				{ name: 'Pattern', value: 'p' },
				{ name: 'Style variation', value: 's' },
				{ name: 'Cancel', value: 'cancel' }
			]
		});
	} catch (error) {
		return;
	}
	if (typeKey === 'cancel') { return; }
	if (typeKey === 'b') {
		let name;
		try {
			name = await input({ message: 'Block name:' });
		} catch (error) {
			return;
		}
		if (!name) { log('warn', 'No name provided.'); return; }
		const slug = utils.slugify(name);
		const blockDir = `${project.path}/blocks/${slug}`;
		const srcDir = `${blockDir}/src`;
		try {
			await fs.access(blockDir);
			log('warn', `Block ${slug} already exists.`);
			return;
		} catch (error) {
			//
		}
		const created = await utils.ensureDir(srcDir);
		if (!created) { return; }
		const blockJsonPath = `${srcDir}/block.json`;
		const indexJsPath = `${srcDir}/index.js`;
		try {
			const libDir = path.dirname(fileURLToPath(import.meta.url));
			const templateBlockJsonRaw = await fs.readFile(path.resolve(libDir, 'templates/block/block.json'), 'utf8');
			let templateBlock = JSON.parse(templateBlockJsonRaw);
			templateBlock.name = `custom/${slug}`;
			templateBlock.title = name;
			await fs.writeFile(blockJsonPath, JSON.stringify(templateBlock, null, '\t'));
			const templateIndex = await fs.readFile(path.resolve(libDir, 'templates/block/index.js'), 'utf8');
			await fs.writeFile(indexJsPath, templateIndex);
			log('success', `Created block at blocks/${slug}`);
			if (project.components.blocks) {
				project.components.blocks.addBlock(blockDir);
			}
		} catch (error) {
			console.error(error);
			log('error', `Failed to scaffold block`);
		}
	} else if (typeKey === 'p') {
		let name;
		try { name = await input({ message: 'Pattern name:' }); } catch (error) { return; }
		if (!name) { log('warn', 'No name provided.'); return; }
		const slug = utils.slugify(name);
		const patternsDir = `${project.path}/patterns`;
		await utils.ensureDir(patternsDir);
		const filePath = `${patternsDir}/${slug}.php`;
		try {
			await fs.access(filePath);
			log('warn', `Pattern ${slug}.php already exists.`);
			return;
		} catch (error) {
			//
		}
		try {
			const libDir = path.dirname(fileURLToPath(import.meta.url));
			const templatePath = path.resolve(libDir, 'templates/pattern/pattern.php');
			let template = await fs.readFile(templatePath, 'utf8');
			template = template.replace(/Title:\s.*$/m, `Title: ${name}`);
			template = template.replace(/Slug:\s.*$/m, `Slug: custom/${slug}`);
			await fs.writeFile(filePath, template);
			log('success', `Created pattern at patterns/${slug}.php`);
			if (project.components.php?.watcher) {
				project.components.php.watcher.add(filePath);
			} else if (project.components.php?.globs && !project.components.php.globs.includes(filePath)) {
				project.components.php.globs.push(filePath);
			}
		} catch (error) {
			console.error(error);
			log('error', `Failed to create pattern`);
		}
	} else if (typeKey === 's') {
		let name;
		try { name = await input({ message: 'Style variation name:' }); } catch (error) { return; }
		if (!name) { log('warn', 'No name provided.'); return; }
		const slug = utils.slugify(name);
		const stylesDir = `${project.path}/styles`;
		await utils.ensureDir(stylesDir);
		const filePath = `${stylesDir}/${slug}.json`;
		try {
			await fs.access(filePath);
			log('warn', `Style variation ${slug}.json already exists.`);
			return;
		} catch (error) {

		}
		try {
			const libDir = path.dirname(fileURLToPath(import.meta.url));
			const templatePath = path.resolve(libDir, 'templates/style/style.json');
			let templateRaw = await fs.readFile(templatePath, 'utf8');
			let templateObj;
			try {
				templateObj = JSON.parse(templateRaw);
			} catch (error) {
				console.error(error);
				throw new Error('Invalid style variation template JSON');
			}
			templateObj.title = name;
			templateObj.slug = slug;
			await fs.writeFile(filePath, JSON.stringify(templateObj, null, '\t'));
			log('success', `Created style variation at styles/${slug}.json`);
		} catch (error) {
			console.error(error);
			log('error', `Failed to create style variation`);
		}
	}
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
		const rawConfig = JSON.parse(configFile);
		if (!validateConfig(rawConfig)) {
			log('error', 'Configuration validation failed');
			process.exit(1);
		}
		project.config = mergeWithDefaults(rawConfig);
		project.paths.images = project.config.imagesPath || `${project.path}/${project.paths.src.src}/${project.paths.src.images}`;
		project.paths.errorLog = project.config.errorLogPath;
		project.entries = project.config.entries || {};
		setupConfigWatcher();
	} catch (error) {
		if (error.code === 'ENOENT') {
			log('warn', 'No config file found, using defaults');
			project.config = mergeWithDefaults({});
			project.paths.images = `${project.path}/${project.paths.src.src}/${project.paths.src.images}`;
			project.entries = {};
		} else {
			console.error(error);
			log('error', `Failed to load config: ${error.message}`);
			process.exit(1);
		}
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
		await restartBuild();
	});
	configWatcher.on('error', (error) => {
		console.error(error);
		log('warn', `Config file watcher error`);
	});
	project.configWatcher = configWatcher;
}

export default project;
