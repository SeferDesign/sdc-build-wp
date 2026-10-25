#!/usr/bin/env node
import { default as project, init, keypressListen } from './lib/project.js';
import { build } from './lib/build.js';

(async () => {
	if (await init() === false) { return; }
	if (project.argv.watch) {
		keypressListen();
	}
	await build(project.argv.watch);
})();
