#!/usr/bin/env node
process.env.NODE_ENV = 'production';
const pathConfig = require('path');
const path = pathConfig.resolve(__dirname, '.');
const { spawn } = require('child_process');
const webpack = require('webpack');
const config = require(path + '/_config/webpack.config.js');
const argv = require('minimist')(process.argv.slice(2));

let commandArgs = [
	'--config',
	path + '/_config/webpack.config.js',
	(argv.watch ? '--watch' : null)
];

const command = spawn('webpack', commandArgs, {
	stdio: 'inherit'
});

// command.stdout.on('data', data => {
// 	console.log(`${data}`);
// });

// command.stderr.on('data', data => {
// 	console.log(`stderr: ${data}`);
// });

// command.on('error', (error) => {
// 	console.log(`error: ${error.message}`);
// });

// command.on('close', code => {
// 	console.log(`child process exited with code ${code}`);
// });
