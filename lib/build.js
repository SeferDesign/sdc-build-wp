import { default as project } from './project.js';
import * as utils from './utils.js';
import log from './logging.js';
import chalk from 'chalk';


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
				console.error(error);
				log('error', `Failed to initialize ${build} component`);
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
		project.components.server.logURLs();
		log('info', `${chalk.underline.green('r')}estart, ${chalk.underline.green('c')}lear cache, ${chalk.underline.green('p')}ause/resume, ${chalk.underline.green('n')}ew component, ${chalk.underline.green('q')}uit`);

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

export async function restartBuild() {
	await utils.stopActiveComponents();
	utils.clearScreen();
	build(true);
}
