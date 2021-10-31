// based heavily on Nick Salloum's 'node-pretty-log'
// https://github.com/callmenick/node-pretty-log

const chalk = require('chalk');

function getTime() {
	return new Date().toLocaleTimeString('en-US');
}

function log(type, ...messages) {
	switch (type) {
		case 'success':
			console.log.call(
				console,
				chalk.green('✓'),
				chalk.gray(getTime()),
				...messages
			);
			break;
		case 'error':
			console.log.call(
				console,
				chalk.red('×'),
				chalk.bgRed.gray(getTime()),
				...messages
			);
			break;
		case 'warn':
			console.log.call(
				console,
				chalk.yellow('!'),
				chalk.bgYellow.gray(getTime()),
				...messages
			);
			break;
		case 'info':
		default:
			console.log.call(
				console,
				chalk.blue('ℹ'),
				chalk.bgBlue.gray(getTime()),
				...messages
			);
			break;
	}
}

module.exports = log;
