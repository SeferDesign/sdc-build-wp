import { default as project } from './project.js';
import * as utils from './utils.js';
import log from './logging.js';

export async function build(watch = false) {
	if (project.builds.includes('cache')) {
		try {
			await project.components.cache.init();
		} catch (error) {
			log('warn', `Failed to initialize cache: ${error.message}`);
		}
	}

	if (watch && project.builds.includes('server')) {
		project.builds.splice(project.builds.indexOf('server'), 1);
		project.builds.unshift('server');
		project.components.server.serve(false);
	}

	let initialBuildTimerStart = performance.now();
	log('info', `Started initial build [${project.builds.join(', ')}]`);

	let promisesBuilds = [];
	for (let build of project.builds) {
		if (build === 'cache') { continue; }

		promisesBuilds.push(
			project.components[build].init().catch(error => {
				log('error', `Failed to initialize ${build} component: ${error.message}`);
				return { failed: true, component: build, error };
			})
		);
	}

	const results = await Promise.all(promisesBuilds);

	const failedComponents = results.filter(result => result && result.failed);
	if (failedComponents.length > 0) {
		log('warn', `Continuing without failed components: ${failedComponents.map(f => f.component).join(', ')}`);
		project.builds = project.builds.filter(build => !failedComponents.some(f => f.component === build));
	}

	utils.clearScreen();
	log('info', `Finished initial build in ${Math.round((performance.now() - initialBuildTimerStart) / 1000)} seconds`);

	if (watch && project.builds.includes('server')) {
		project.isRunning = true;
		project.builds.splice(project.builds.indexOf('server'), 1);
		project.builds.push('server');
		log('info', `Started watching [${project.builds.join(', ')}]`);
		log('info', `[r] to restart, [c] to clear cache, [p] to pause/resume, [q] to quit`);

		for (let build of project.builds) {
			try {
				await project.components[build].watch();
			} catch (error) {
				log('error', `Failed to start watcher for ${build}: ${error.message}`);
				log('warn', `Continuing without ${build} watcher`);
			}
		}
	} else {
		process.emit('SIGINT');
	}
}

export function restartBuild() {
	utils.stopActiveComponents();
	setTimeout(() => {
		utils.clearScreen();
		build(true);
	}, 100);
}
