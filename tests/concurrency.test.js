import assert from 'node:assert/strict';
import { test } from 'node:test';
import project from '../lib/project.js';
import { runWithConcurrency, withBuildSlot } from '../lib/utils.js';

test('shared slots bound simultaneous work across independent components', async t => {
	const originalConfig = project.config;
	t.after(() => { project.config = originalConfig; });
	project.config = { buildConcurrency: { default: 8, total: 2 } };
	let active = 0;
	let maximum = 0;
	const work = async value => {
		active++;
		maximum = Math.max(maximum, active);
		await new Promise(resolve => setTimeout(resolve, 5));
		active--;
		return value;
	};
	const results = await Promise.all([
		runWithConcurrency([1, 2, 3], 3, value => withBuildSlot(() => work(value))),
		runWithConcurrency([4, 5, 6], 3, value => withBuildSlot(() => work(value)))
	]);
	assert.equal(maximum, 2);
	assert.deepEqual(results, [[1, 2, 3], [4, 5, 6]]);
});

test('shared slots release on errors and work with nested discovery at total one', async t => {
	const originalConfig = project.config;
	t.after(() => { project.config = originalConfig; });
	project.config = { buildConcurrency: { total: 1 } };
	const failed = withBuildSlot(() => { throw new Error('build failure'); });
	const results = runWithConcurrency([1, 2], 2, directory =>
		runWithConcurrency([1, 2], 2, file =>
			withBuildSlot(() => `${directory}/${file}`)
		)
	);
	await assert.rejects(failed, /build failure/);
	assert.deepEqual(await results, [['1/1', '1/2'], ['2/1', '2/2']]);
});
