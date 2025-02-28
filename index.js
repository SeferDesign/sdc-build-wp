#!/usr/bin/env node
import path from 'path';
import parseArgs from 'minimist';
const argv = parseArgs(process.argv.slice(2));
import { glob } from 'node:fs/promises';
import { promises as fs } from 'fs';
import { Tail } from 'tail';
import project from './lib/project.js';
import * as utils from './lib/utils.js';
import log from './lib/logging.js';
import * as Components from './lib/components/index.js';

const styleComponent = new Components.style();
const scriptsComponent = new Components.scripts();
const blocksComponent = new Components.blocks();
const imagesComponent = new Components.images();
const fontsComponent = new Components.fonts();
const phpComponent = new Components.php();
const serverComponent = new Components.server();

let builds = argv.builds ? argv.builds.split(',') : [
	'sass',
	'js',
	'blocks',
	'images',
	'fonts',
	'php'
];

for (const [name, files] of Object.entries(project.package.sdc.entries)) {
	project.entries[name] = [];
	for (let file of files) {
		let fullPath = project.path + file;
		project.entries[name].push(fullPath);
		let extension = path.parse(fullPath).ext;
		if (builds.includes('sass') && extension == '.scss') {
			project.files.sass.push({
				'name': name,
				'file': fullPath
			});
		} else if (builds.includes('js') && extension == '.js') {
			project.files.js.push({
				'name': name,
				'file': fullPath
			});
		}
	}
}

(async() => {

	let initialBuildTimerStart = Date.now();
	log('info', `Starting initial build`);

	if (builds.includes('sass')) {
		project.globs.sass = await Array.fromAsync(
			glob(project.package?.sdc?.sassGlobPath ||
			`${project.path}{/_src/style,/blocks}/**/*.scss`)
		);
		await styleComponent.process();
	}

	if (builds.includes('js')) {
		project.globs.js = await Array.fromAsync(
			glob(project.package?.sdc?.jsGlobPath ||
			`${project.path}/_src/scripts/**/*.js`)
		);
		await scriptsComponent.process();
	}

	if (builds.includes('blocks')) {
		project.globs.blocks = await Array.fromAsync(
			glob(`${project.path}/blocks/*`)
		);
		project.globs.blocksSass = await Array.fromAsync(
			glob(`${project.path}/blocks/*/src/*.scss`)
		);
		// for (var filename of project.globs.blocksSass) {
		// 	project.entries[`blocks/${path.basename(path.dirname(filename))}/style`] = [ filename ];
		// }
		await blocksComponent.process();
	}

	if (builds.includes('images')) {
		project.globs.images = await Array.fromAsync(
			glob(project.package?.sdc?.imagesPath ||
			`${project.paths.images}/**/*`)
		);
		project.globs.imageDirectories = [
			project.paths.images,
			...await utils.getAllSubdirectories(project.paths.images)
		];
		await imagesComponent.process();
	}

	if (builds.includes('fonts')) {
		await fontsComponent.process();
	}

	if (builds.includes('php')) {
		project.globs.php = await Array.fromAsync(
			glob(project.package?.sdc?.jsGlobPath ||
			`${project.path}/**/*.php`)
		);
		project.globs.blocksPHP = await Array.fromAsync(
			glob(`${project.path}/blocks/*/build/*.php`)
		);
		project.chokidarOpts.ignored.concat(project.globs.blocksPHP);
		// await phpComponent.process(null, { lintType: 'warn' }); // this errors "Fatal error: Allowed memory size"
	}

	log('info', `Finished initial build in ${Math.round((Date.now() - initialBuildTimerStart) / 1000)} seconds`);

	if (argv.watch) {

		serverComponent.start();

		if (builds.includes('sass')) {
			styleComponent.watch();
		}

		if (builds.includes('js')) {
			scriptsComponent.watch();
		}

		if (builds.includes('blocks')) {
			blocksComponent.watch();
		}

		if (builds.includes('images')) {
			imagesComponent.watch();
		}

		if (builds.includes('php') && project.shouldPHPLint) {
			phpComponent.watch();
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
