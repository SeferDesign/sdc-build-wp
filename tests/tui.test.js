import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PassThrough } from 'node:stream';
import React from 'react';
import { render, useFocusManager } from 'ink';
import project, { keypressListen } from '../lib/project.js';
import { TUI, TUIRoot } from '../lib/tui.js';
import tui from '../lib/tui.js';
import BaseComponent from '../lib/components/base.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { validateCreation, getCreationDestination } from '../lib/creation.js';

const settle = () => new Promise(resolve => setTimeout(resolve, 80));

async function createTerminal(t, { incrementalRendering = true } = {}) {
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
	let activeId;
	function TerminalRoot() {
		activeId = useFocusManager().activeId;
		return React.createElement(TUIRoot, { tui: dashboard });
	}
	dashboard.app = render(React.createElement(TerminalRoot), {
		stdin,
		stdout,
		stderr: stdout,
		exitOnCtrlC: false,
		patchConsole: true,
		interactive: true,
		alternateScreen: true,
		incrementalRendering,
		kittyKeyboard: { mode: 'disabled' }
	});
	const rerender = dashboard.app.rerender;
	dashboard.app.rerender = () => rerender(React.createElement(TerminalRoot));
	t.after(async () => {
		await dashboard.destroy();
		stdin.destroy();
		stdout.destroy();
	});
	await settle();
	return { stdin, stdout, dashboard, getOutput: () => output, getFocus: () => activeId };
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

test('second header row and feed top border hide below 16 terminal rows and return on resize', async t => {
	const { dashboard, stdout, getOutput } = await createTerminal(t, { incrementalRendering: false });
	const visibleRows = [];
	const originalGetVisibleLogLines = dashboard.getVisibleLogLines.bind(dashboard);
	t.mock.method(dashboard, 'getVisibleLogLines', rows => {
		visibleRows.push(rows);
		return originalGetVisibleLogLines(rows);
	});
	const getLastFrame = outputStart => {
		const output = stripVTControlCharacters(getOutput().slice(outputStart));
		return output.slice(output.lastIndexOf('SDC Build WP'));
	};
	dashboard.setURLs('http://localhost:3000', '');
	dashboard.isPaused = true;
	stdout.columns = 120;
	stdout.rows = 16;
	let outputStart = getOutput().length;
	stdout.emit('resize');
	await settle();
	let frame = getLastFrame(outputStart);
	assert.match(frame, /Components: scripts, style/);
	assert.match(frame, /Local: http:\/\/localhost:3000/);
	assert.equal((frame.match(/╭/g) || []).length, 1, 'feed should have a top border');
	const tallLogRows = visibleRows.at(-1);

	outputStart = getOutput().length;
	stdout.rows = 15;
	stdout.emit('resize');
	await settle();
	frame = getLastFrame(outputStart);
	assert.doesNotMatch(frame, /Components:|Local:|localhost/);
	assert.match(frame, /SDC Build WP/);
	assert.match(frame, /r restart, p pause, n new, q quit/);
	assert.match(frame, /PAUSED/);
	assert.equal((frame.match(/╭/g) || []).length, 0, 'feed should not have a top border');
	assert.equal(visibleRows.at(-1), tallLogRows + 1, 'hiding the header row and feed border should gain a log row when losing one terminal row');

	outputStart = getOutput().length;
	stdout.rows = 16;
	stdout.emit('resize');
	await settle();
	frame = getLastFrame(outputStart);
	assert.match(frame, /Components: scripts, style/);
	assert.match(frame, /Local: http:\/\/localhost:3000/);
	assert.equal((frame.match(/╭/g) || []).length, 1, 'feed top border should return');
	assert.equal(visibleRows.at(-1), tallLogRows);
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

test('Tab selects panels, filters component logs, and modal prompts trap and restore focus', async t => {
	const { stdin, dashboard, getOutput, getFocus } = await createTerminal(t);
	dashboard.log('global message');
	dashboard.log('script message', 'scripts');
	dashboard.log('style message', 'style');
	await settle();
	assert.equal(getFocus(), 'logs');
	assert.doesNotMatch(getOutput(), /Focus:/);
	assert.doesNotMatch(getOutput(), /Logs:/);
	stdin.write('f');
	await settle();
	stdin.write('\x1b[Z');
	await settle();
	stdin.write('\t');
	await settle();
	assert.equal(getFocus(), 'filter');
	stdin.write('\x1b[B');
	await settle();
	assert.equal(dashboard.selectedComponent, 'scripts');
	assert.deepEqual(dashboard.getVisibleLogLines(10), ['script message']);
	const prompt = dashboard.showInput('Name:');
	await settle();
	assert.equal(getFocus(), 'prompt');
	stdin.write('\t');
	stdin.write('\x1b[B');
	await settle();
	assert.equal(dashboard.selectedComponent, 'scripts');
	stdin.write('\x1b[200~hello\x1b[201~');
	await settle();
	assert.equal(dashboard._activePrompt.value, 'hello');
	stdin.write('\r');
	await settle();
	assert.equal(await prompt, 'hello');
	assert.equal(getFocus(), 'filter');
	stdin.write('\x1b');
	await settle();
	assert.equal(dashboard.selectedComponent, null);
	assert.equal(dashboard.getLogHistory(), 'global message\nscript message\nstyle message');
});

test('component filtering uses source metadata, bounds scrolling, and preserves complete history', () => {
	const dashboard = new TUI();
	dashboard.isInitialized = true;
	dashboard.setComponents(['scripts', 'style']);
	for (let index = 0; index < 20; index++) {
		dashboard.log(`message ${index}`, index % 2 ? 'scripts' : 'style');
	}
	dashboard.selectComponent('scripts');
	dashboard.scrollLogs(100);
	assert.deepEqual(dashboard.getVisibleLogLines(2), ['message 1', 'message 3']);
	dashboard.selectComponent('style');
	assert.equal(dashboard._logScrollOffset, 0);
	assert.deepEqual(dashboard.getVisibleLogLines(2), ['message 16', 'message 18']);
	assert.equal(dashboard.getLogHistory().split('\n').length, 20);
	const restored = new TUI();
	restored.setState(dashboard.getState());
	assert.equal(restored.selectedComponent, 'style');
	dashboard.setComponents(['scripts']);
	assert.equal(dashboard.selectedComponent, null);
	assert.throws(() => dashboard.selectComponent('unknown'), /Unknown log component/);
});

test('multiline diagnostics use physical rows, preserve history and styles, and strip terminal controls', () => {
	const dashboard = new TUI();
	dashboard.isInitialized = true;
	dashboard.setComponents(['php', 'scripts']);
	const diagnostic = '\x1b[31mPHP Fatal error:\r\n\tStack trace:\r#0 first()\n#1 second()\x1b[0m\n';
	dashboard.log(diagnostic, 'php');
	dashboard.log('scripts complete', 'scripts');
	dashboard.selectComponent('php');
	assert.deepEqual(dashboard.getVisibleLogLines(2).map(stripVTControlCharacters), ['#0 first()', '#1 second()']);
	dashboard.scrollLogs(2);
	assert.deepEqual(dashboard.getVisibleLogLines(2), [
		'\x1b[31mPHP Fatal error:\x1b[0m',
		'\x1b[31m    Stack trace:\x1b[0m'
	]);
	dashboard.setSearchQuery('FIRST()');
	assert.deepEqual(dashboard.getVisibleLogLines(2).map(stripVTControlCharacters), ['#0 first()']);
	assert.equal(dashboard.getLogHistory(), diagnostic + '\nscripts complete');
	dashboard.log('before\x1b[2J\x1b[Hafter\x1b]0;title\x07\x08\x00', 'php');
	dashboard.setSearchQuery('');
	assert.equal(dashboard.getVisibleLogLines(1)[0], 'beforeafter');
});

test('bursts of multiline errors stay within the log viewport and console output uses Ink redraws', async t => {
	const originalWarn = console.warn;
	const { dashboard, getOutput } = await createTerminal(t);
	const rowCounts = [];
	const getLines = dashboard.getVisibleLogLines.bind(dashboard);
	t.mock.method(dashboard, 'getVisibleLogLines', rows => {
		const lines = getLines(rows);
		assert.ok(lines.length <= rows);
		assert.ok(lines.every(line => !/[\r\n\t]/.test(line)));
		rowCounts.push(rows);
		return lines;
	});
	for (let index = 0; index < 30; index++) {
		dashboard.log(`PHP warning ${index}\r\n\tcontext ${index}\ntrace ${index}\n`, 'scripts');
	}
	await settle();
	assert.ok(rowCounts.at(-1) > 0);
	assert.equal(dashboard.getFilteredLogHistory().length, 90);
	assert.equal(dashboard.getVisibleLogLines(1)[0], 'trace 29');
	const start = getOutput().length;
	console.warn('external diagnostic');
	await settle();
	const consoleOutput = getOutput().slice(start);
	assert.match(consoleOutput, /external diagnostic/);
	assert.match(stripVTControlCharacters(consoleOutput), new RegExp(`SDC Build WP v${project.version}`));
	await dashboard.destroy();
	assert.equal(console.warn, originalWarn, 'Ink restores the console on teardown');
});

test('search matches literal visible text, combines component filters, and includes new logs', () => {
	const dashboard = new TUI();
	dashboard.isInitialized = true;
	dashboard.setComponents(['scripts', 'style']);
	dashboard.log('\x1b[31mBuild ERROR [x]\x1b[0m', 'scripts');
	dashboard.log('error in stylesheet', 'style');
	dashboard.log('everything fine', 'scripts');
	dashboard.setSearchQuery('ERROR');
	assert.equal(dashboard.getFilteredLogHistory().length, 2);
	dashboard.selectComponent('scripts');
	assert.deepEqual(dashboard.getVisibleLogLines(10), ['\x1b[31mBuild ERROR [x]\x1b[0m']);
	dashboard.log('another error', 'scripts');
	assert.equal(dashboard.getFilteredLogHistory().length, 2);
	dashboard.setSearchQuery('[x]');
	assert.equal(dashboard.getFilteredLogHistory().length, 1);
	dashboard.setSearchQuery('31m');
	assert.deepEqual(dashboard.getVisibleLogLines(10), ['No matching logs.']);
	const restored = new TUI();
	restored.setState(dashboard.getState());
	assert.equal(restored.searchQuery, '31m');
	assert.equal(dashboard.getLogHistory().split('\n').length, 4);
});

test('/ opens live search, Enter keeps it, Escape restores query and scroll, and empty input clears', async t => {
	const { dashboard, stdin, getFocus } = await createTerminal(t);
	const commands = [];
	dashboard.commandHandler = input => commands.push(input);
	for (let index = 0; index < 40; index++) {
		dashboard.log(`Error item ${index}`, 'scripts');
	}
	dashboard.log('all clear', 'style');
	stdin.write('f');
	await settle();
	stdin.write('/');
	await settle();
	assert.equal(getFocus(), 'prompt');
	assert.equal(dashboard._activePrompt.type, 'search');
	stdin.write('\x1b[200~ERROR\x1b[201~');
	await settle();
	assert.equal(dashboard.searchQuery, 'ERROR');
	assert.equal(dashboard.getFilteredLogHistory().length, 40);
	stdin.write('\r');
	await settle();
	assert.equal(getFocus(), 'logs');
	assert.equal(dashboard.hasPrompt(), false);
	dashboard.scrollLogs(3);
	await settle();
	const previousOffset = dashboard._logScrollOffset;
	stdin.write('/');
	await settle();
	stdin.write('q');
	await settle();
	assert.equal(dashboard.searchQuery, 'ERRORq');
	assert.deepEqual(dashboard.getVisibleLogLines(10), ['No matching logs.']);
	stdin.write('\x1b');
	await settle();
	assert.equal(dashboard.searchQuery, 'ERROR');
	assert.equal(dashboard._logScrollOffset, previousOffset);
	assert.equal(getFocus(), 'logs');
	stdin.write('/');
	await settle();
	for (let index = 0; index < 5; index++) {
		stdin.write('\x7f');
		await settle();
	}
	stdin.write('\r');
	await settle();
	assert.equal(dashboard.searchQuery, '');
	assert.equal(dashboard.getFilteredLogHistory().length, 41);
	assert.deepEqual(commands, []);
	const creation = dashboard.showInput('Name:');
	await settle();
	stdin.write('/');
	await settle();
	assert.equal(dashboard._activePrompt.value, '/');
	stdin.write('\x1b');
	await settle();
	assert.equal(await creation, null);
});

test('f toggles Filter without dispatching a command or interfering with name input', async t => {
	const { stdin, dashboard, getOutput, getFocus } = await createTerminal(t);
	const commands = [];
	dashboard.commandHandler = input => commands.push(input);
	assert.doesNotMatch(getOutput(), /Filter/);
	stdin.write('\t');
	await settle();
	assert.equal(getFocus(), 'logs');
	stdin.write('f');
	await settle();
	assert.equal(getFocus(), 'filter');
	assert.deepEqual(commands, []);
	stdin.write('\x1b[B');
	await settle();
	assert.equal(dashboard.selectedComponent, 'scripts');
	stdin.write('f');
	await settle();
	assert.equal(getFocus(), 'logs');
	assert.equal(dashboard.selectedComponent, 'scripts');
	stdin.write('\t');
	await settle();
	assert.equal(getFocus(), 'logs');
	stdin.write('f');
	await settle();
	assert.equal(getFocus(), 'filter');
	const prompt = dashboard.showInput('Name:');
	await settle();
	stdin.write('f');
	await settle();
	assert.equal(dashboard._activePrompt.value, 'f');
	stdin.write('\r');
	await settle();
	assert.equal(await prompt, 'f');
	assert.equal(getFocus(), 'filter');
});

test('component selector keeps selection visible in short and narrow terminals', async t => {
	const { dashboard, stdin, stdout, getOutput } = await createTerminal(t);
	stdin.write('f');
	await settle();
	dashboard.setComponents(Array.from({ length: 20 }, (_, index) => `component-${index}`));
	dashboard.selectComponent('component-19');
	stdout.rows = 16;
	stdout.emit('resize');
	await settle();
	assert.match(getOutput().slice(-3000), /> component-19/);
	stdout.columns = 40;
	stdout.rows = 24;
	stdout.emit('resize');
	await settle();
	assert.match(getOutput().slice(-3000), /< component-19 >/);
	stdin.write('\x1b[B');
	await settle();
	assert.equal(dashboard.selectedComponent, null);
});

test('component logger tags multiline diagnostics without changing their text', t => {
	const originalInitialized = tui.isInitialized;
	tui.isInitialized = true;
	t.after(() => { tui.isInitialized = originalInitialized; });
	const calls = [];
	t.mock.method(tui, 'log', (message, component) => calls.push({ message, component }));
	class ScriptsComponent extends BaseComponent {}
	new ScriptsComponent().log(null, 'first line\nsecond line');
	assert.deepEqual(calls, [
		{ message: 'first line', component: 'scripts' },
		{ message: 'second line', component: 'scripts' }
	]);
});

test('creation form manages fields, validates names, pastes safely, and restores previous focus', async t => {
	const { stdin, dashboard, getFocus, getOutput } = await createTerminal(t);
	stdin.write('f');
	await settle();
	const creation = dashboard.showCreation();
	await settle();
	assert.equal(getFocus(), 'creation-type');
	stdin.write('\x1b[B');
	await settle();
	stdin.write('\t');
	await settle();
	assert.equal(getFocus(), 'creation-name');
	stdin.write('\r');
	await settle();
	assert.match(getOutput(), /Enter a name containing letters or numbers/);
	assert.equal(dashboard.hasPrompt(), true);
	stdin.write('\x1b[200~My\r\nPattern\x1b[201~');
	await settle();
	stdin.write('\t');
	await settle();
	assert.equal(getFocus(), 'creation-submit');
	stdin.write('\t');
	await settle();
	assert.equal(getFocus(), 'creation-cancel');
	stdin.write('\t');
	await settle();
	assert.equal(getFocus(), 'creation-type');
	stdin.write('\x1b[Z');
	await settle();
	assert.equal(getFocus(), 'creation-cancel');
	stdin.write('\x1b[Z');
	await settle();
	stdin.write('\r');
	await settle();
	assert.deepEqual(await creation, { type: 'Pattern', name: 'My Pattern' });
	assert.equal(getFocus(), 'filter');
	const cancelled = dashboard.showCreation();
	await settle();
	stdin.write('\x1b');
	await settle();
	assert.equal(await cancelled, null);
	assert.equal(getFocus(), 'filter');
});

test('New command preserves scaffolding and watcher registration for all creation types', async t => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-creation-test-'));
	const originalPath = project.path;
	const originalComponents = project.components;
	const originalRunning = project.isRunning;
	const originalHandler = tui.commandHandler;
	const stdin = process.stdin;
	const descriptor = Object.getOwnPropertyDescriptor(stdin, 'isTTY');
	Object.defineProperty(stdin, 'isTTY', { value: true, configurable: true });
	t.after(async () => {
		project.path = originalPath;
		project.components = originalComponents;
		project.isRunning = originalRunning;
		tui.commandHandler = originalHandler;
		if (descriptor) { Object.defineProperty(stdin, 'isTTY', descriptor); }
		else { delete stdin.isTTY; }
		await fs.rm(directory, { recursive: true, force: true });
	});
	project.path = directory;
	project.isRunning = true;
	const blocks = [];
	const patterns = [];
	project.components = {
		blocks: { addBlock: file => blocks.push(file) },
		php: { watcher: { add: file => patterns.push(file) } }
	};
	keypressListen();
	for (const type of ['Block', 'Pattern', 'Style variation']) {
		t.mock.method(tui, 'showCreation', async () => ({ type, name: 'Test Name' }));
		await tui.commandHandler('n', {});
	}
	const block = JSON.parse(await fs.readFile(path.join(directory, 'blocks/test-name/src/block.json'), 'utf8'));
	assert.equal(block.title, 'Test Name');
	assert.equal(block.name, 'custom/test-name');
	assert.ok(await fs.readFile(path.join(directory, 'blocks/test-name/src/index.js'), 'utf8'));
	assert.match(await fs.readFile(path.join(directory, 'patterns/test-name.php'), 'utf8'), /Title: Test Name/);
	const style = JSON.parse(await fs.readFile(path.join(directory, 'styles/test-name.json'), 'utf8'));
	assert.equal(style.title, 'Test Name');
	assert.equal(style.slug, 'test-name');
	assert.deepEqual(blocks, [path.join(directory, 'blocks/test-name')]);
	assert.deepEqual(patterns, [path.join(directory, 'patterns/test-name.php')]);
});

test('creation validation rejects existing destinations for every type', async t => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-validation-test-'));
	t.after(() => fs.rm(directory, { recursive: true, force: true }));
	for (const type of ['Block', 'Pattern', 'Style variation']) {
		await validateCreation(directory, type, 'Test Name');
		const destination = path.join(directory, getCreationDestination(type, 'Test Name'));
		await fs.mkdir(path.dirname(destination), { recursive: true });
		if (type === 'Block') { await fs.mkdir(destination); }
		else { await fs.writeFile(destination, 'existing content'); }
		await assert.rejects(validateCreation(directory, type, 'Test Name'), /already exists/);
	}
	await assert.rejects(validateCreation(directory, 'Pattern', '!!!'), /letters or numbers/);
	await fs.writeFile(path.join(directory, 'styles', 'blocked'), 'not a directory');
	await assert.rejects(validateCreation(path.join(directory, 'styles', 'blocked'), 'Pattern', 'Test'), /Cannot check/);
});

test('duplicate creation keeps the name editable and previews the corrected destination', async t => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sdc-form-validation-'));
	const originalPath = project.path;
	project.path = directory;
	t.after(async () => {
		project.path = originalPath;
		await fs.rm(directory, { recursive: true, force: true });
	});
	await fs.mkdir(path.join(directory, 'blocks', 'existing'), { recursive: true });
	const { dashboard, stdin, getFocus, getOutput } = await createTerminal(t);
	const creation = dashboard.showCreation();
	await settle();
	stdin.write('\t');
	await settle();
	stdin.write('\x1b[200~Existing\x1b[201~');
	await settle();
	stdin.write('\r');
	await settle();
	assert.equal(dashboard.hasPrompt(), true);
	assert.equal(getFocus(), 'creation-name');
	assert.match(getOutput(), /blocks\/existing already exists/);
	stdin.write('\x1b[200~ New\x1b[201~');
	await settle();
	assert.match(getOutput(), /Slug: existing-new/);
	assert.match(getOutput(), /Destination: blocks\/existing-new/);
	stdin.write('\r');
	await settle();
	assert.deepEqual(await creation, { type: 'Block', name: 'Existing New' });
	assert.equal(getFocus(), 'logs');
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
