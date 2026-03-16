#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as readline from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packagePath = resolve(__dirname, '../package.json');

const bumpType = process.argv[2] || 'patch';

if (!['patch', 'minor', 'major'].includes(bumpType)) {
	console.error(`Invalid bump type: "${bumpType}". Must be patch, minor, or major.`);
	process.exit(1);
}

const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);

let nextVersion;
if (bumpType === 'major') {
	nextVersion = `${major + 1}.0.0`;
} else if (bumpType === 'minor') {
	nextVersion = `${major}.${minor + 1}.0`;
} else {
	nextVersion = `${major}.${minor}.${patch + 1}`;
}

pkg.version = nextVersion;
writeFileSync(packagePath, JSON.stringify(pkg, null, '\t') + '\n');

console.log(`Bumped version: ${major}.${minor}.${patch} → ${nextVersion}`);

execSync('npm install', { stdio: 'inherit' });

execSync('git add package.json package-lock.json', { stdio: 'inherit' });
execSync(`git commit -m "Version bump"`, { stdio: 'inherit' });
execSync(`git tag v${nextVersion}`, { stdio: 'inherit' });

console.log(`Tagged commit as v${nextVersion}`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Push branch and tags to origin? [y/N] ', (answer) => {
	rl.close();
	if (answer.trim().toLowerCase() === 'y') {
		execSync('git push', { stdio: 'inherit' });
		execSync('git push --tags', { stdio: 'inherit' });
		console.log('Pushed branch and tags.');
	} else {
		console.log('Skipped push.');
	}
});
