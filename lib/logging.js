// based heavily on Nick Salloum's 'node-pretty-log'
// https://github.com/callmenick/node-pretty-log

const chalk = require('chalk');

function getTime() {
	const now = new Date();
	return now.toLocaleTimeString('en-US');
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
				chalk.gray(getTime()),
				...messages
			);
			break;
		case 'info':
			console.log.call(
				console,
				chalk.blue('ℹ'),
				chalk.gray(getTime()),
				...messages
			);
			break;
		default:
			console.log.call(
				console,
				chalk.blue('ℹ'),
				chalk.gray(getTime()),
				...messages
			);
	}
}

module.exports = log;
