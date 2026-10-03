import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PassThrough } from 'node:stream';
import React from 'react';
import { render } from 'ink';
import project, { keypressListen } from '../lib/project.js';
import { TUI, TUIRoot } from '../lib/tui.js';
import tui from '../lib/tui.js';

const settle = () => new Promise(resolve => setTimeout(resolve, 80));

async function createTerminal(t) {
	const stdin = new PassThrough();
	stdin.isTTY = true;
	stdin.setRawMode = value => { stdin.isRaw = value; };
	stdin.ref = () => {};
	stdin.unref = () => {};
	const stdout = new PassThrough();
	stdout.isTTY = true;
	stdout.columns = 80;
	stdout.rows = 24;
	let output = '';
	stdout.on('data', chunk => { output += chunk.toString(); });
	const dashboard = new TUI();
	dashboard.isInitialized = true;
	dashboard.setCommands('r restart, p pause, n new, q quit');
	dashboard.setComponents(['scripts', 'style']);
	dashboard.app = render(React.createElement(TUIRoot, { tui: dashboard }), {
		stdin,
		stdout,
		exitOnCtrlC: false,
		patchConsole: false,
		alternateScreen: true,
		incrementalRendering: true,
		kittyKeyboard: { mode: 'disabled' }
	});
	t.after(async () => {
		await dashboard.destroy();
		stdin.destroy();
		stdout.destroy();
	});
	await settle();
	return { stdin, stdout, dashboard, getOutput: () => output };
}

test('Ink separates pasted names from commands and supports Backspace, Delete, and Escape', async t => {
	const terminal = await createTerminal(t);
	const { stdin, dashboard } = terminal;
	const commands = [];
	dashboard.commandHandler = (input, key) => { commands.push({ input, key }); };
	stdin.write('\x1b[200~q\x1b[201~');
	await settle();
	assert.equal(commands.length, 0);
	const prompt = dashboard.showInput('Name:');
	await settle();
	stdin.write('\x1b[200~Meal\r\nPlan\t😀\x1b[201~');
	await settle();
	assert.equal(dashboard._activePrompt.value, 'Meal Plan 😀');
	stdin.write('\x7f');
	await settle();
	assert.equal(dashboard._activePrompt.value, 'Meal Plan ');
	stdin.write('\x1b[3~');
	await settle();
	assert.equal(dashboard._activePrompt.value, 'Meal Plan');
	stdin.write('\r');
	await settle();
	assert.equal(await prompt, 'Meal Plan');
	const cancelled = dashboard.showInput('Cancel:');
	await settle();
	stdin.write('\x1b');
	await settle();
	assert.equal(await cancelled, null);
	stdin.write('p');
	await settle();
	assert.equal(commands.at(-1).input, 'p');
	const interrupted = dashboard.showInput('Interrupt:');
	await settle();
	stdin.write('\x03');
	await settle();
	assert.equal(commands.at(-1).input, 'c');
	assert.equal(commands.at(-1).key.ctrl, true);
	await dashboard.destroy();
	assert.equal(await interrupted, null);
});

test('Ink measures wrapped layout, reacts to resize, and restores terminal modes', async t => {
	const { dashboard, stdout, stdin, getOutput } = await createTerminal(t);
	const visibleRows = [];
	const originalGetVisibleLogLines = dashboard.getVisibleLogLines.bind(dashboard);
	t.mock.method(dashboard, 'getVisibleLogLines', rows => {
		visibleRows.push(rows);
		return originalGetVisibleLogLines(rows);
	});
	dashboard.setURLs('https://a-long-local-hostname.example.test:3000', '');
	for (let index = 0; index < 40; index++) {
		dashboard.log(`line-${index} ${'界😀'.repeat(50)}`);
	}
	await settle();
	const wideRows = visibleRows.at(-1);
	assert.ok(wideRows > 0 && wideRows < stdout.rows);
	assert.match(getOutput(), /\x1b\[\?1049h/);
	assert.match(getOutput(), /\x1b\[\?2004h/);
	stdout.columns = 24;
	stdout.rows = 12;
	stdout.emit('resize');
	await settle();
	assert.ok(visibleRows.at(-1) < wideRows);
	assert.ok(visibleRows.at(-1) >= 0 && visibleRows.at(-1) < stdout.rows);
	const prompt = dashboard.showMenu(['Block', 'Pattern', 'Cancel'], 'Create:');
	await settle();
	stdin.write('\x1b[B');
	await settle();
	assert.equal(dashboard._activePrompt.selectedIndex, 1);
	stdin.write('\r');
	await settle();
	assert.deepEqual(await prompt, { value: 'Pattern', index: 1 });
	stdout.rows = 3;
	stdout.columns = 10;
	stdout.emit('resize');
	await settle();
	assert.deepEqual(dashboard.getVisibleLogLines(0), []);
	await dashboard.destroy();
	assert.match(getOutput(), /\x1b\[\?1049l/);
	assert.match(getOutput(), /\x1b\[\?2004l/);
	assert.equal(stdin.isRaw, false);
	assert.equal(stdout.listenerCount('resize'), 0);
});

test('mouse reports stay out of prompts and scroll through Ink input', async t => {
	const { stdin, dashboard } = await createTerminal(t);
	for (let index = 0; index < 40; index++) {
		dashboard.log(`line-${index}`);
	}
	await settle();
	stdin.write('\x1b[<64;5;5M');
	await settle();
	assert.equal(dashboard._logScrollOffset, 3);
	const prompt = dashboard.showInput('Name:');
	await settle();
	stdin.write('\x1b[<64;5;5M');
	await settle();
	assert.equal(dashboard._activePrompt.value, '');
	stdin.write('\x1b');
	await settle();
	assert.equal(await prompt, null);
});

test('loading animation advances and stops when initial loading finishes', async t => {
	const { dashboard, getOutput } = await createTerminal(t);
	dashboard._isInitialLoading = true;
	dashboard.render();
	await new Promise(resolve => setTimeout(resolve, 350));
	const frames = getOutput().match(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/g) || [];
	assert.ok(new Set(frames).size >= 2, 'spinner should display multiple animation frames');
	assert.match(getOutput(), /Initial loading/);
	dashboard.finishInitialLoading();
	await settle();
	const stoppedOutput = getOutput();
	await new Promise(resolve => setTimeout(resolve, 200));
	assert.equal(getOutput(), stoppedOutput, 'finished spinner should not schedule more output');
});

test('queued renders are safe after destruction and plain-output init stays inactive', async () => {
	const dashboard = new TUI();
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		dashboard.init();
		assert.equal(dashboard.isInitialized, false);
	}
	dashboard.isInitialized = true;
	let rendered = false;
	dashboard.app = {
		rerender: () => { rendered = true; },
		unmount: () => {},
		waitUntilExit: async () => {},
		cleanup: () => {}
	};
	dashboard.render();
	await dashboard.destroy();
	await settle();
	assert.equal(rendered, false);
});

test('watch commands ignore modifiers and pause/resume using parsed Ink keys', async t => {
	const originalHandler = tui.commandHandler;
	const originalRunning = project.isRunning;
	const stdin = process.stdin;
	const ttyDescriptor = Object.getOwnPropertyDescriptor(stdin, 'isTTY');
	Object.defineProperty(stdin, 'isTTY', { value: true, configurable: true });
	t.after(() => {
		tui.commandHandler = originalHandler;
		project.isRunning = originalRunning;
		if (ttyDescriptor) {
			Object.defineProperty(stdin, 'isTTY', ttyDescriptor);
		} else {
			delete stdin.isTTY;
		}
	});
	keypressListen();
	project.isRunning = true;
	await tui.commandHandler('p', { meta: true });
	assert.equal(project.isRunning, true);
	await tui.commandHandler('p', {});
	assert.equal(project.isRunning, false);
	await tui.commandHandler('p', {});
	assert.equal(project.isRunning, true);
});
