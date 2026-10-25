import { default as project } from './project.js';
import * as utils from './utils.js';
import log from './logging.js';
import { styleText } from 'node:util';
import tui from './tui.js';
import { validateWordPress, logValidation, watchWordPressValidation } from './validation.js';

export async function build(watch = false) {
	project.buildErrors = [];
	tui.setWordPressProjectLabel(await utils.getWordPressProjectLabel(project.path));

	if (watch) {
		tui.setWordPressVersion(null);
		tui.init();
		tui.setComponents(project.builds, true);
		const commands = `${styleText('gray', 'Commands:')} ${styleText(['underline', 'green'], 'r')}estart, ${styleText(['underline', 'green'], 'c')}lear cache, ${styleText(['underline', 'green'], 'p')}ause/resume, ${styleText(['underline', 'green'], 'n')}ew component, ${styleText(['underline', 'green'], 'i')}nfo, ${styleText(['underline', 'green'], 'f')}ilter, ${styleText(['underline', 'green'], '/')}search, ${styleText(['underline', 'green'], 'q')}uit`;
		tui.setCommands(commands);
	}

	log('info', 'Started sdc-build-wp');
	const initialBuildTimerStart = performance.now();
	log('info', `Started initial build [${project.builds.join(', ')}]`);
	const validationOptions = {
		root: project.path,
		localProxyURL: project.config.browsersync?.localProxyURL,
		wordpressVersionCommand: project.config.wordpressVersionCommand,
		useCache: project.argv.cache !== false && !project.argv['no-cache']
	};
	const validationResult = await validateWordPress(validationOptions);
	tui.setWordPressVersion(validationResult.wordpressVersion);
	const errors = logValidation(validationResult, log);
	if (errors && !watch) {
		process.exitCode = 1;
		process.emit('SIGINT');
		return;
	}

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

	const cache = project.builds.includes('cache') ? project.components.cache : null;
	cache?.beginBatch();
	let results;
	try {
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

		results = await Promise.all(promisesBuilds);
	} finally {
		await cache?.endBatch();
	}

	const failedComponents = results.filter(result => result && result.failed);
	if (failedComponents.length > 0) {
		log('warn', `Continuing without failed components: ${failedComponents.map(f => f.component).join(', ')}`);
		project.builds = project.builds.filter(build => !failedComponents.some(f => f.component === build));
	}

	utils.clearScreen();

	if (watch) {
		project.isRunning = true;
		if (project.builds.includes('server')) {
			project.builds.splice(project.builds.indexOf('server'), 1);
			project.builds.push('server');
		}

		tui.finishInitialLoading();
		log('info', `Finished initial build in ${Math.round((performance.now() - initialBuildTimerStart) / 1000)} seconds`);
		log('info', `Started watching [${project.builds.join(', ')}]`);

		tui.setComponents(project.builds, true);

		if (project.builds.includes('server')) {
			project.components.server.logURLs();
		}

		const watchResults = await Promise.allSettled(
			project.builds.map(build => project.components[build].watch())
		);
		project.validationWatcher = watchWordPressValidation({
			...validationOptions,
			context: validationResult.context,
			ignored: project.chokidarOpts.ignored,
			isRunning: () => project.isRunning
		}, log);

		watchResults.forEach((result, index) => {
			if (result.status === 'rejected') {
				const build = project.builds[index];
				log('error', `Failed to start watcher for ${build}: ${result.reason.message}`);
				log('warn', `Continuing without ${build} watcher`);
			}
		});
	} else {
		tui.finishInitialLoading();
		if (project.buildErrors.length > 0) {
			process.exitCode = 1;
			log('warn', `Build failed with ${project.buildErrors.length} error(s)`);
		} else {
			log('info', `Finished initial build in ${Math.round((performance.now() - initialBuildTimerStart) / 1000)} seconds`);
		}
		process.emit('SIGINT');
	}
}

export async function restartBuild(clearCache = false) {
	await utils.stopActiveComponents();
	if (clearCache) { await project.components.cache.clearCache(); }
	utils.clearScreen();
	await build(true);
}
