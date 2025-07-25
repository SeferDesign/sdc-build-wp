import { default as project } from './project.js';
import * as utils from './utils.js';
import log from './logging.js';

export default async function(watch = false) {
	if (watch && project.builds.includes('server')) {
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

	if (watch && project.builds.includes('server')) {
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
