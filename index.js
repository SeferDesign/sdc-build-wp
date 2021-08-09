#!/usr/bin/env node
process.env.NODE_ENV = 'production';
const pathConfig = require('path');
const path = pathConfig.resolve(__dirname, '.');
const { exec } = require('child_process');
const webpack = require('webpack');
const config = require(path + '/_config/webpack.config.js');
const argv = require('minimist')(process.argv.slice(2));

let commandArgs = [
	'--config',
	path + '/_config/webpack.config.js'
];

if (argv.watch) {
	commandArgs.push('--watch');
}

const { spawn } = require('child_process');

const command = spawn('webpack', commandArgs);

command.stdout.on('data', data => {
	console.log(`${data}`);
});

command.stderr.on('data', data => {
	console.log(`stderr: ${data}`);
});

command.on('error', (error) => {
	console.log(`error: ${error.message}`);
});

command.on('close', code => {
	console.log(`child process exited with code ${code}`);
});

// exec(command, (error, stdout, stderr) => {
//     if (error) {
//         console.log(`error: ${error.message}`);
//         return;
//     }
//     if (stderr) {
//         console.log(`stderr: ${stderr}`);
//         return;
//     }
//     console.log(`stdout: ${stdout}`);
// });

// const compiler = webpack(config);

// // webpack(config, (err, stats) => {
// // 	if (stats) {
// // 		console.log(stats.toString());
// // 	}
// // });

// const watching = compiler.watch({
// 	aggregateTimeout: 300,
//   poll: undefined
// }, (err, stats) => { // [Stats Object](#stats-object)
// 	console.log('this is a TEST');
//   // Print watch/build result here...
// 	if (stats) {
// 		console.log(stats.toString());
// 	}
// });

