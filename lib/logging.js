// based heavily on Nick Salloum's 'node-pretty-log'
// https://github.com/callmenick/node-pretty-log
import { styleText } from 'node:util';
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
			icon = styleText('green', '✔');
			time = styleText('gray', getTime());
			break;
		case 'error':
			icon = styleText('red', '✖');
			time = styleText(['bgRed', 'gray'], getTime());
			if (project.builds.includes('server') && project.isRunning) {
				project.components.server.server.notify('ERROR', 2500);
			}
			break;
		case 'warn':
			icon = styleText('yellow', '⚠');
			time = styleText(['bgYellow', 'gray'], getTime());
			break;
		case 'php':
			icon = styleText('blue', 'ℹ');
			time = styleText('gray', getTime());
			prefix = styleText('gray', 'PHP:  ');
			break;
		case 'info':
			icon = styleText('blue', 'ℹ');
			time = styleText(['bgBlue', 'gray'], getTime());
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
