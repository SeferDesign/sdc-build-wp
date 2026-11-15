import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { addAgentsReference, copyAgentsSkill, installAgentsHelpers } from '../lib/agents.js';

const referenceTarget = 'node_modules/sdc-build-wp/.agents/skills/sdc-build-wp/SKILL.md';

test('agents reference creates, appends to, and never duplicates in AGENTS.md', async t => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-agents-'));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	const created = await addAgentsReference({ root });
	assert.equal(created.status, 'updated');
	const fresh = await fs.readFile(path.join(root, 'AGENTS.md'), 'utf8');
	assert.ok(fresh.startsWith('# Agents Instructions'));
	assert.ok(fresh.includes(referenceTarget));
	const repeat = await addAgentsReference({ root });
	assert.equal(repeat.status, 'skipped');
	assert.equal(await fs.readFile(path.join(root, 'AGENTS.md'), 'utf8'), fresh);
	await fs.writeFile(path.join(root, 'AGENTS.md'), '# Existing\n\nKeep this content.\n');
	await addAgentsReference({ root });
	const appended = await fs.readFile(path.join(root, 'AGENTS.md'), 'utf8');
	assert.ok(appended.startsWith('# Existing\n\nKeep this content.\n\n## sdc-build-wp'));
	assert.equal(appended.split(referenceTarget).length - 1, 1);
});

test('agents copy installs the packaged skill into the project', async t => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-agents-copy-'));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	const result = await copyAgentsSkill({ root });
	assert.equal(result.status, 'updated');
	const copied = await fs.readFile(path.join(root, '.agents/skills/sdc-build-wp/SKILL.md'), 'utf8');
	assert.match(copied, /^---\nname: sdc-build-wp\n/);
	await assert.rejects(installAgentsHelpers({ root, choice: 'bogus' }), /Unknown agents install choice/);
});

test('agents CLI command runs non-interactively with an explicit choice', async t => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-agents-cli-'));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'agents-fixture' }));
	const cli = new URL('../index.js', import.meta.url).pathname;
	const { stdout } = await promisify(execFile)(process.execPath, [cli, 'agents', 'reference'], { cwd: root, timeout: 10000 });
	assert.match(stdout, /AGENTS\.md/);
	assert.ok((await fs.readFile(path.join(root, 'AGENTS.md'), 'utf8')).includes(referenceTarget));
	await assert.rejects(promisify(execFile)(process.execPath, [cli, 'agents'], { cwd: root, timeout: 10000 }), error => {
		assert.equal(error.code, 1);
		assert.match(error.stdout + error.stderr, /Interactive prompt unavailable/);
		return true;
	});
});
