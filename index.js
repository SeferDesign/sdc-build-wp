#!/usr/bin/env node
import parseArgs from 'minimist';
const argv = parseArgs(process.argv.slice(2));
import { promises as fs } from 'fs';
import { Tail } from 'tail';
import project from './lib/project.js';
import log from './lib/logging.js';
import * as LibComponents from './lib/components/index.js';

project.components = {
	style: new LibComponents.style(),
	scripts: new LibComponents.scripts(),
	blocks: new LibComponents.blocks(),
	images: new LibComponents.images(),
	fonts: new LibComponents.fonts(),
	php: new LibComponents.php(),
	server: new LibComponents.server()
};

let builds = argv.builds ? argv.builds.split(',') : Object.keys(project.components).map(key => project.components[key].slug);

(async() => {

	let initialBuildTimerStart = Date.now();
	log('info', `Starting initial build`);
	for (let build of builds) {
		await project.components[build].init();
	}
	log('info', `Finished initial build in ${Math.round((Date.now() - initialBuildTimerStart) / 1000)} seconds`);

	if (argv.watch) {
		for (let build of builds) {
			await project.components[build].watch();
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
