// based heavily on Nick Salloum's 'node-pretty-log'
// https://github.com/callmenick/node-pretty-log
import chalk from 'chalk';
import { default as project } from './project.js';
import tui from './tui.js';

function getTime() {
	return new Date().toLocaleTimeString('en-US');
}

function log(type, ...messages) {
	let icon, time, prefix = '';

	switch (type) {
		case 'success':
			icon = chalk.green('✔');
			time = chalk.gray(getTime());
			break;
		case 'error':
			icon = chalk.red('✖');
			time = chalk.bgRed.gray(getTime());
			if (project.builds.includes('server') && project.isRunning) {
				project.components.server.server.notify('ERROR', 2500);
			}
			break;
		case 'warn':
			icon = chalk.yellow('⚠');
			time = chalk.bgYellow.gray(getTime());
			break;
		case 'php':
			icon = chalk.blue('ℹ');
			time = chalk.gray(getTime());
			prefix = chalk.gray('PHP:  ');
			break;
		case 'info':
		default:
			icon = chalk.blue('ℹ');
			time = chalk.bgBlue.gray(getTime());
			break;
	}

	const logMessage = [icon, time, prefix, ...messages].filter(Boolean).join(' ');
	tui.log(logMessage);
}

export default log;
