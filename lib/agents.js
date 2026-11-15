import path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import readline from 'node:readline/promises';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillRelativeDir = path.join('.agents', 'skills', 'sdc-build-wp');
const referenceTarget = 'node_modules/sdc-build-wp/.agents/skills/sdc-build-wp/SKILL.md';

const referenceSection = `## sdc-build-wp

This project is built with [sdc-build-wp](https://github.com/SeferDesign/sdc-build-wp). Read \`${referenceTarget}\` and follow its development standards and conventions for all work in this repository.
`;

export const agentsChoices = ['reference', 'copy'];

export async function addAgentsReference({ root }) {
	const agentsPath = path.join(root, 'AGENTS.md');
	let existing = null;
	try {
		existing = await fs.readFile(agentsPath, 'utf8');
	} catch (error) {
		if (error.code !== 'ENOENT') { throw error; }
	}
	if (existing?.includes(referenceTarget)) {
		return { status: 'skipped', message: 'AGENTS.md already references the sdc-build-wp skill' };
	}
	const content = existing === null ?
		`# Agents Instructions\n\n${referenceSection}` :
		`${existing.replace(/\n*$/, '\n\n')}${referenceSection}`;
	await fs.writeFile(agentsPath, content);
	return {
		status: 'updated',
		message: existing === null ? 'Created AGENTS.md with an sdc-build-wp reference' : 'Added sdc-build-wp reference to AGENTS.md'
	};
}

export async function copyAgentsSkill({ root, source = path.join(packageRoot, skillRelativeDir) }) {
	const destination = path.join(root, skillRelativeDir);
	if (path.resolve(destination) === path.resolve(source)) {
		return { status: 'skipped', message: 'Skill source and destination are the same directory' };
	}
	await fs.access(path.join(source, 'SKILL.md'));
	await fs.cp(source, destination, { recursive: true, force: true });
	return { status: 'updated', message: `Copied sdc-build-wp skill to ${skillRelativeDir.split(path.sep).join('/')}/` };
}

export async function installAgentsHelpers({ root, choice, source }) {
	if (choice === 'reference') {
		return await addAgentsReference({ root });
	}
	if (choice === 'copy') {
		return await copyAgentsSkill({ root, source });
	}
	throw new Error(`Unknown agents install choice: ${choice}. Available: ${agentsChoices.join(', ')}`);
}

export async function promptAgentsChoice() {
	if (!process.stdin.isTTY) {
		throw new Error(`Interactive prompt unavailable. Run \`sdc-build-wp agents ${agentsChoices.join('|')}\` instead.`);
	}
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	try {
		const answer = await rl.question(`Install AI agents helpers:
  [1] Add a quick reference to this project's AGENTS.md (recommended)
  [2] Copy the sdc-build-wp skill into .agents/skills/
  [q] Cancel
Choice: `);
		const trimmed = answer.trim().toLowerCase();
		if (trimmed === '1' || trimmed === 'reference') { return 'reference'; }
		if (trimmed === '2' || trimmed === 'copy') { return 'copy'; }
		return null;
	} finally {
		rl.close();
	}
}
