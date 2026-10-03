import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

async function createReleaseFixture(t) {
	const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-release-')));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	await fs.mkdir(path.join(root, 'lib'));
	await fs.mkdir(path.join(root, 'bin'));
	await fs.copyFile(new URL('../lib/release.js', import.meta.url), path.join(root, 'lib/release.mjs'));
	const manifest = JSON.stringify({ name: 'release-fixture', version: '1.2.3' });
	await fs.writeFile(path.join(root, 'package.json'), manifest);
	const calls = path.join(root, 'calls');
	await fs.writeFile(path.join(root, 'bin/npm'), `#!/bin/sh
printf 'npm %s\\n' "$*" >> "$RELEASE_CALLS"
if [ "$1" = test ]; then
  printf 'test cwd: %s\\n' "$PWD" >> "$RELEASE_CALLS"
  exit "$TEST_EXIT_CODE"
fi
`, { mode: 0o755 });
	await fs.writeFile(path.join(root, 'bin/git'), `#!/bin/sh
printf 'git %s\\n' "$*" >> "$RELEASE_CALLS"
if [ "$1" = rev-parse ]; then printf 'main\\n'; fi
`, { mode: 0o755 });
	const run = (bump, exitCode) => spawnSync(process.execPath, [path.join(root, 'lib/release.mjs'), bump, '--no-push'], {
		cwd: os.tmpdir(),
		encoding: 'utf8',
		env: {
			...process.env,
			PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}`,
			RELEASE_CALLS: calls,
			TEST_EXIT_CODE: String(exitCode)
		}
	});
	return { root, calls, manifest, run };
}

for (const bump of ['patch', 'minor', 'major']) {
	test(`failed tests block ${bump} release before any mutations`, async t => {
		const { root, calls, manifest, run } = await createReleaseFixture(t);
		const result = run(bump, 1);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /Release aborted: all tests must pass/);
		assert.equal(await fs.readFile(path.join(root, 'package.json'), 'utf8'), manifest);
		assert.equal(await fs.readFile(calls, 'utf8'), `npm test\ntest cwd: ${root}\n`);
	});
}

test('passing tests allow release steps in order', async t => {
	const { root, calls, run } = await createReleaseFixture(t);
	const result = run('patch', 0);
	assert.equal(result.status, 0, result.stderr);
	assert.equal(JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version, '1.2.4');
	assert.equal(await fs.readFile(calls, 'utf8'), [
		'npm test',
		`test cwd: ${root}`,
		'npm install',
		'git add package.json package-lock.json',
		'git commit -m Version bump',
		'git tag -a v1.2.4 -m v1.2.4',
		'git rev-parse --abbrev-ref HEAD',
		''
	].join('\n'));
});
