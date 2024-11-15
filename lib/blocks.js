import { promises as fs } from 'fs';
import path from 'path';
import project from '../lib/project.js';
import log from './logging.js';
import { stat } from 'fs/promises';
import { spawn } from 'child_process';
import process from 'process';

function cmd(...command) {
  let p = spawn(command[0], command.slice(1), {
		shell: true
	});
  return new Promise((resolveFunc) => {
    p.stdout.on('data', (x) => {
			if (x.toString().includes('Error:')) {
				process.stdout.write(x.toString());
				log('error', `Failed building blocks - See above error.`);
			}
    });
    p.stderr.on('data', (x) => {
			if (x.toString().includes('Error:')) {
				process.stderr.write(x.toString());
				log('error', `Failed building blocks - See above error.`);
			}
    });
    p.on('exit', (code) => {
      resolveFunc(code);
    });
  });
}

const buildBlock = async (entry) => {
	let workingBlockJson = null;
	let potentialBlockJsonLocations = [
		`${entry}/src/block.json`,
		// `${entry}/block.json`
	];
	for (var location of potentialBlockJsonLocations) {
		try {
			await stat(location);
			workingBlockJson = location
			break;
		} catch (error) {
			//
		}
	}
	if (workingBlockJson === null) {
		log('error', `Failed building ${entry} blocks - no block.json found.`);
		return false;
	}
	let timerStart = Date.now();
	let cmds = [`build`];
	for (var file of (await fs.readdir(`${entry}/src`)).filter(file => path.extname(file) == '.js')) {
		cmds.push(`src/${file}`);
	}
	cmds.push('--webpack-copy-php');
	await cmd(`cd ${entry} && ${project.path}/node_modules/@wordpress/scripts/bin/wp-scripts.js`, ...cmds);
	log('success', `Built ${entry.replace(project.path, '')} in ${Date.now() - timerStart}ms`);
};

export default buildBlock;
