import { default as project } from './project.js';
import * as utils from './utils.js';
import log from './logging.js';
import chalk from 'chalk';
import tui from './tui.js';


export async function build(watch = false) {

	if (watch) {
		tui.init();
		tui.setComponents(project.builds, true);
		const commands = `Commands: ${chalk.underline.green('r')}estart, ${chalk.underline.green('c')}lear cache, ${chalk.underline.green('p')}ause/resume, ${chalk.underline.green('n')}ew component, ${chalk.underline.green('q')}uit`;
		tui.setCommands(commands);
	}

	log('info', `Started sdc-build-wp`);

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
				log(null, error);
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

	if (watch && project.builds.includes('server')) {
		project.isRunning = true;
		project.builds.splice(project.builds.indexOf('server'), 1);
		project.builds.push('server');

		log('info', `Finished initial build in ${Math.round((performance.now() - initialBuildTimerStart) / 1000)} seconds`);
		log('info', `Started watching [${project.builds.join(', ')}]`);

		tui.setComponents(project.builds, true);

		project.components.server.logURLs();

		for (let build of project.builds) {
			try {
				await project.components[build].watch();
			} catch (error) {
				log('error', `Failed to start watcher for ${build}: ${error.message}`);
				log('warn', `Continuing without ${build} watcher`);
			}
		}
	} else {
		log('info', `Finished initial build in ${Math.round((performance.now() - initialBuildTimerStart) / 1000)} seconds`);
		process.emit('SIGINT');
	}
}

export async function restartBuild() {
	await utils.stopActiveComponents();
	utils.clearScreen();
	build(true);
}
