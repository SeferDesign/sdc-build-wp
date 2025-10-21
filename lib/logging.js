// based heavily on Nick Salloum's 'node-pretty-log'
// https://github.com/callmenick/node-pretty-log
import chalk from 'chalk';
import { default as project } from './project.js';
import tui from './tui.js';

function getTime() {
	return new Date().toLocaleTimeString('en-US');
}

function log(type, ...messages) {
	let icon, time = null;
	let prefix = '';

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
			icon = chalk.blue('ℹ');
			time = chalk.bgBlue.gray(getTime());
			break;
	}

	let messagesString = messages.join(' ');

	const logMessage = [icon, time, prefix, messagesString].filter(Boolean).join(' ');
	if (tui.isInitialized) {
		if (!type && messagesString.includes('\n')) {
			messagesString.split('\n').forEach(line => {
				if (line.trim()) {
					tui.log(line);
				}
			});
			return;
		}
		tui.log(String(logMessage));
	} else {
		switch (type) {
			case 'error':
				console.error(logMessage);
				break;
			case 'warn':
				console.warn(logMessage);
				break;
			default:
				console.log(logMessage);
		}
	}
}

export default log;
