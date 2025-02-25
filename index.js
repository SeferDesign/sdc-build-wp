#!/usr/bin/env node
import path from 'path';
import project from './lib/project.js';
import parseArgs from 'minimist';
const argv = parseArgs(process.argv.slice(2));
import chokidar from 'chokidar';
import { glob, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { Tail } from 'tail';

import log from './lib/logging.js';
import { buildSass, buildSassTheme, getImportedFiles as getImportedFilesSass } from './lib/style.js';
import buildJS from './lib/scripts.js';
import { default as buildPHP, shouldPHPLint } from './lib/php.js';
import buildBlock from './lib/blocks.js';
import buildImages from './lib/images.js';
import buildFonts from './lib/fonts.js';
import buildBrowserSync from './lib/browsersync.js';

let paths = {
	theme: {
		json: `${project.path}/theme.json`,
		scss: `${project.path}/_src/style/partials/_theme.scss`
	},
	nodeModules: `${project.path}/node_modules`,
	composer: {
		vendor: `${project.path}/vendor`
	},
	images: project.package?.sdc?.imagesPath || `${project.path}/_src/images`,
	errorLog: process.env.ERROR_LOG_PATH || project.package.sdc?.error_log_path || '../../../../../logs/php/error.log'
};

let chokidarOpts = {
	ignoreInitial: true,
	ignored: [
		paths.nodeModules,
		paths.composer.vendor,
		paths.theme.scss
	]
};

let globs = {};
let entries = {};
let filesSass = [];
let filesJS = [];

let builds = argv.builds ? argv.builds.split(',') : [
	'sass',
	'js',
	'blocks',
	'images',
	'fonts',
	'php'
];

(async() => {

	let initialBuildTimerStart = Date.now();
	log('info', `Starting initial build`);

	if (builds.includes('sass')) {
		globs.sass = await Array.fromAsync(
			glob(project.package?.sdc?.sassGlobPath ||
			`${project.path}{/_src/style,/blocks}/**/*.scss`)
		);
	}
	if (builds.includes('js')) {
		globs.js = await Array.fromAsync(
			glob(project.package?.sdc?.jsGlobPath ||
			`${project.path}/_src/scripts/**/*.js`)
		);
	}
	if (builds.includes('blocks')) {
		globs.blocks = await Array.fromAsync(
			glob(`${project.path}/blocks/*`)
		);
		globs.blocksSass = await Array.fromAsync(
			glob(`${project.path}/blocks/*/src/*.scss`)
		);
		// for (var filename of globs.blocksSass) {
		// 	entries[`blocks/${path.basename(path.dirname(filename))}/style`] = [ filename ];
		// }
	}
	if (builds.includes('images')) {
		globs.images = await Array.fromAsync(
			glob(project.package?.sdc?.imagesPath ||
			`${paths.images}/**/*`)
		);
		globs.imageDirectories = [
			paths.images,
			...await getAllSubdirectories(paths.images)
		];
	}
	if (builds.includes('php')) {
		globs.php = await Array.fromAsync(
			glob(project.package?.sdc?.jsGlobPath ||
			`${project.path}/**/*.php`)
		);
		globs.blocksPHP = await Array.fromAsync(
			glob(`${project.path}/blocks/*/build/*.php`)
		);
		chokidarOpts.ignored = [
			...chokidarOpts.ignored,
			...globs.blocksPHP
		];
	}

	for (const [name, files] of Object.entries(project.package.sdc.entries)) {
		entries[name] = [];
		files.forEach(function(file) {
			entries[name].push(project.path + file);
		});
	}

	for (const [name, files] of Object.entries(entries)) {
		files.forEach(function(file) {
			switch (path.parse(file).ext) {
				case '.scss':
					if (builds.includes('sass')) {
						filesSass.push({
							'name': name,
							'file': file
						});
					}
					break;
				case '.js':
					if (builds.includes('js')) {
						filesJS.push({
							'name': name,
							'file': file
						});
					}
					break;
			}
		});
	}

	if (builds.includes('sass')) {
		await runSass(null, true);
	}
	if (builds.includes('js')) {
		await runJS();
	}
	if (builds.includes('blocks')) {
		await runBlocks();
	}
	if (builds.includes('images')) {
		await frontrunImages();
	}
	if (builds.includes('fonts')) {
		await buildFonts(project.path + '/_src/fonts');
	}
	// if (builds.includes('php') && shouldPHPLint) {
	// 	await runPHP(null, 'warn'); // this errors "Fatal error: Allowed memory size"
	// }

	log('info', `Finished initial build in ${Math.round((Date.now() - initialBuildTimerStart) / 1000)} seconds`);

	if (argv.watch) {

		buildBrowserSync();

		if (builds.includes('sass')) {
			chokidar.watch([
				...[paths.theme.json],
				globs.sass
			], {
				...chokidarOpts
			}).on('all', (event, path) => {
				let hasRanSingle = false;
				for (var block of filesSass) {
					if (path == block.file || getImportedFilesSass(block.file).includes(path)) {
						runSass(block.file, path == paths.theme.json);
						hasRanSingle = true;
					}
				}
				if (!hasRanSingle) {
					runSass(null, path == paths.theme.json);
				}
			});
		}

		if (builds.includes('js')) {
			chokidar.watch(globs.js, {
				...chokidarOpts
			}).on('all', (event, path) => {
				runJS();
			});
		}

		if (builds.includes('blocks')) {
			for (let block of globs.blocks) {
				chokidar.watch(`${block}/src`, {
					...chokidarOpts
				}).on('all', (event, path) => {
					runBlocks(block);
				});
			}
		}

		if (builds.includes('images')) {
			chokidar.watch(paths.images, chokidarOpts).on('all', (event, path) => {
				frontrunImages();
			});
		}

		if (builds.includes('php') && shouldPHPLint) {
			chokidar.watch(globs.php, {
				...chokidarOpts
			}).on('all', (event, path) => {
				runPHP(path);
			});
		}

		if (existsSync(paths.errorLog)) {
			let errorLogTail = new Tail(paths.errorLog);
			errorLogTail.on('line', function(data) {
				log('php', data);
			});
		} else {
			log('info', `Cannot find error log @ ${paths.errorLog}. Skipping watching php error logs`);
		}
	}

})();

async function frontrunImages() {
	const promisesImages = globs.imageDirectories.map(directory => buildImages(directory));
	await Promise.all(promisesImages);
}

async function runBlocks(singleBlock) {
	if (singleBlock) {
		await buildBlock(singleBlock);
	} else {
		const promisesBlocks = globs.blocks.map(block => buildBlock(block));
		await Promise.all(promisesBlocks);
	}
}

async function runSass(singleEntry, buildTheme = true) {
	if (buildTheme) {
		await buildSassTheme();
	}
	for (var block of filesSass) {
		if (!singleEntry || singleEntry == block.file) {
			await buildSass(block.file, block.name, globs.sass);
			if (singleEntry == block.file) {
				break;
			}
		}
	}
}

async function runJS() {
	const promisesJS = filesJS.map(block => buildJS(block.file, block.name, globs.js));
	await Promise.all(promisesJS);
}

async function runPHP(file, method) {
	await buildPHP(file, method);
}

async function getAllSubdirectories(dir) {
	let subdirectories = [];
	const subdirectoriesEntries = await readdir(dir, { withFileTypes: true });
	for (const subdirectoriesEntry of subdirectoriesEntries) {
		if (subdirectoriesEntry.isDirectory()) {
			const subdirPath = path.join(dir, subdirectoriesEntry.name);
			subdirectories.push(subdirPath);
			const nestedSubdirs = await getAllSubdirectories(subdirPath);
			subdirectories = subdirectories.concat(nestedSubdirs);
		}
	}
	return subdirectories;
}
