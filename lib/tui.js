import React from 'react';
import { Box, Text, render as renderInk, useInput, useWindowSize, useBoxMetrics, usePaste, useAnimation, useFocus, useFocusManager } from 'ink';
import { styleText } from 'node:util';
import log from './logging.js';
import { slugify } from './utils.js';

const sgrMouseRegex = /(?:\x1b)?\[<(\d+);(\d+);(\d+)([mM])/g;
const headerColumnGap = 2;
const loadingFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function LoadingSpinner() {
	const { frame } = useAnimation({ interval: 80 });
	return React.createElement(Text, null, loadingFrames[frame % loadingFrames.length]);
}

function LogPanel({ tui, rows }) {
	const { isFocused } = useFocus({ id: 'logs', autoFocus: true, isActive: !tui.hasPrompt() });
	useInput((input, key) => {
		if (key.eventType === 'release') { return; }
		if (key.upArrow) { tui.scrollLogs(1); }
		if (key.downArrow) { tui.scrollLogs(-1); }
		if (key.pageUp) { tui.scrollLogs(rows); }
		if (key.pageDown) { tui.scrollLogs(-rows); }
	}, { isActive: isFocused && !tui.hasPrompt() });
	const lines = tui.getVisibleLogLines(rows);
	return React.createElement(
		Box,
		{ borderStyle: 'round', borderColor: isFocused ? 'cyan' : 'blue', paddingX: 1, flexDirection: 'column', flexGrow: 1, flexBasis: 0, minWidth: 0, minHeight: 0, overflow: 'hidden' },
		lines.map((line, index) => React.createElement(Text, { key: `log-${index}`, wrap: 'truncate-end' }, line))
	);
}

function FilterPanel({ tui, compact, rows }) {
	const { isFocused } = useFocus({ id: 'filter', isActive: !tui.hasPrompt() });
	const choices = [null, ...tui.components];
	const selectedIndex = Math.max(0, choices.indexOf(tui.selectedComponent));
	const visibleCount = Math.max(1, rows);
	const startIndex = Math.max(0, Math.min(selectedIndex - visibleCount + 1, choices.length - visibleCount));
	const visibleChoices = choices.slice(startIndex, startIndex + visibleCount);
	useInput((input, key) => {
		if (key.eventType === 'release') { return; }
		if (key.upArrow || key.leftArrow) {
			tui.selectComponent(choices[(selectedIndex - 1 + choices.length) % choices.length]);
		}
		if (key.downArrow || key.rightArrow) {
			tui.selectComponent(choices[(selectedIndex + 1) % choices.length]);
		}
		if (key.escape) { tui.selectComponent(null); }
	}, { isActive: isFocused && !tui.hasPrompt() });
	return React.createElement(
		Box,
		{ borderStyle: 'round', borderColor: isFocused ? 'cyan' : 'blue', paddingX: 1, flexDirection: 'column', width: compact ? undefined : 20, height: compact ? 4 : undefined, flexShrink: 0, overflow: 'hidden' },
		React.createElement(Text, { bold: isFocused, wrap: 'truncate-end' }, 'Filter'),
		compact
			? React.createElement(Text, { wrap: 'truncate-end' }, `< ${tui.selectedComponent || 'All'} >`)
			: visibleChoices.map(component => React.createElement(Text, { key: component || 'all', color: component === tui.selectedComponent ? 'cyan' : undefined, wrap: 'truncate-end' }, `${component === tui.selectedComponent ? '>' : ' '} ${component || 'All'}`))
	);
}

function PromptPanel({ tui }) {
	const { isFocused } = useFocus({ id: 'prompt', isActive: tui.hasPrompt() && tui._activePrompt.type !== 'creation' });
	useInput((input, key) => {
		if (key.eventType !== 'release' && !(key.ctrl && input === 'c') && !tui.isMouseEscapeSequence(input)) {
			tui.handlePromptInput(input, key);
		}
	}, { isActive: isFocused && tui.hasPrompt() && tui._activePrompt.type !== 'creation' });
	usePaste(text => tui.handlePaste(text), { isActive: isFocused && tui.hasPrompt() });
	if (tui._activePrompt?.type === 'creation') {
		return React.createElement(CreationPanel, { tui });
	}
	return tui.hasPrompt() ? React.createElement(
		Box,
		{ borderStyle: 'round', borderColor: isFocused ? 'cyan' : 'blue', paddingX: 1, marginTop: 1, flexDirection: 'column' },
		tui.getPromptRenderLines().map((line, index) => React.createElement(Text, { key: `prompt-${index}` }, line))
	) : null;
}

function CreationField({ id, children, onInput, onPaste }) {
	const { isFocused } = useFocus({ id });
	useInput((input, key) => {
		if (key.eventType !== 'release' && !key.tab && !key.escape && !(key.ctrl && input === 'c') && !/(?:\x1b)?\[<\d+;\d+;\d+[mM]/.test(input)) {
			onInput(input, key);
		}
	}, { isActive: isFocused });
	usePaste(text => onPaste?.(text), { isActive: isFocused });
	return React.createElement(
		Box,
		{ borderStyle: 'round', borderColor: isFocused ? 'cyan' : 'blue', paddingX: 1 },
		React.createElement(Text, { wrap: 'truncate-end' }, children)
	);
}

function CreationPanel({ tui }) {
	const types = ['Block', 'Pattern', 'Style variation'];
	const [typeIndex, setTypeIndex] = React.useState(0);
	const [name, setName] = React.useState('');
	const [error, setError] = React.useState('');
	const { focus } = useFocusManager();
	const finish = result => {
		const resolve = tui._activePrompt.resolve;
		tui._activePrompt = null;
		tui.render();
		resolve(result);
	};
	const submit = () => {
		const trimmedName = name.trim();
		if (!slugify(trimmedName)) {
			setError('Enter a name containing letters or numbers.');
			focus('creation-name');
			return;
		}
		finish({ type: types[typeIndex], name: trimmedName });
	};
	useInput((input, key) => {
		if (key.escape && key.eventType !== 'release') { finish(null); }
	});
	return React.createElement(
		Box,
		{ borderStyle: 'round', borderColor: 'cyan', paddingX: 1, marginTop: 1, flexDirection: 'column' },
		React.createElement(Text, { bold: true }, 'New component'),
		React.createElement(CreationField, {
			id: 'creation-type',
			onInput: (input, key) => {
				if (key.upArrow || key.leftArrow) { setTypeIndex(index => (index + types.length - 1) % types.length); }
				if (key.downArrow || key.rightArrow) { setTypeIndex(index => (index + 1) % types.length); }
				if (key.return) { focus('creation-name'); }
			}
		}, `Type: < ${types[typeIndex]} >`),
		React.createElement(CreationField, {
			id: 'creation-name',
			onPaste: text => { setName(value => value + sanitizePastedName(text)); setError(''); },
			onInput: (input, key) => {
				if (key.return) { submit(); }
				else if (key.backspace || key.delete) { setName(value => Array.from(value).slice(0, -1).join('')); setError(''); }
				else if (!key.ctrl && !key.meta && !key.super && !key.hyper && input) { setName(value => value + input); setError(''); }
			}
		}, `Name: ${name}`),
		React.createElement(Box, null,
			React.createElement(CreationField, { id: 'creation-submit', onInput: (input, key) => { if (key.return) { submit(); } } }, 'Create'),
			React.createElement(CreationField, { id: 'creation-cancel', onInput: (input, key) => { if (key.return) { finish(null); } } }, 'Cancel')
		),
		error ? React.createElement(Text, { color: 'red' }, error) : null,
		React.createElement(Text, { color: 'gray' }, 'Tab: fields | Arrows: type | Enter: confirm | Esc: cancel')
	);
}

function sanitizePastedName(text) {
	return text.replace(/\r\n|[\r\n\t]/g, ' ').replace(/[\x00-\x1f\x7f-\x9f]/g, '');
}

export function TUIRoot({ tui }) {
	const { rows: terminalRows, columns: terminalColumns } = useWindowSize();
	const headerRef = React.useRef(null);
	const promptRef = React.useRef(null);
	const headerMetrics = useBoxMetrics(headerRef);
	const promptMetrics = useBoxMetrics(promptRef);
	const header = tui.getHeaderLayout();
	const isInitialLoading = tui.isInitialLoading();
	const [isFilterVisible, setFilterVisible] = React.useState(false);
	const compact = terminalColumns < 60;
	const availableLogRows = Math.max(0, Math.floor(terminalRows - headerMetrics.height - promptMetrics.height - 2 - (compact && isFilterVisible ? 4 : 0)));
	const { focus } = useFocusManager();
	const hasPrompt = tui.hasPrompt();
	const promptType = tui._activePrompt?.type;
	React.useEffect(() => {
		focus(hasPrompt ? (promptType === 'creation' ? 'creation-type' : 'prompt') : 'logs');
	}, [hasPrompt, promptType, focus]);
	React.useEffect(() => {
		focus(isFilterVisible ? 'filter' : 'logs');
	}, [isFilterVisible, focus]);

	usePaste(() => {}, { isActive: !hasPrompt });

	useInput((input, key) => {
		if (!tui.isInitialized) {
			return;
		}

		if (tui.isMouseEscapeSequence(input)) {
			if (tui.isMouseEnabled && !tui.hasPrompt()) {
				tui.handleMouseData(input);
			}
			return;
		}

		if (key.eventType === 'release') {
			return;
		}

		if (key.ctrl && input === 'c') {
			tui.dispatchCommand(input, key);
			return;
		}

		if (!hasPrompt && input === 'f' && !key.ctrl && !key.meta && !key.shift && !key.super && !key.hyper) {
			setFilterVisible(visible => !visible);
			return;
		}

		if (!hasPrompt && !key.escape && !key.tab && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow && !key.pageUp && !key.pageDown) {
			tui.dispatchCommand(input, key);
		}
	});

	return React.createElement(
		Box,
		{ flexDirection: 'column', height: terminalRows, maxHeight: terminalRows, width: terminalColumns, maxWidth: terminalColumns, overflow: 'hidden' },
		React.createElement(
			Box,
			{
				ref: headerRef,
				borderStyle: 'round',
				borderColor: 'blue',
				paddingX: 1,
				flexDirection: 'column',
				flexShrink: 0,
				maxHeight: Math.max(0, terminalRows - promptMetrics.height - 1),
				overflow: 'hidden'
			},
			React.createElement(Text, { bold: true, color: 'blue' }, 'SDC Build WP'),
			header.titleLine || header.urlLine
				? React.createElement(
					Box,
					{
						flexDirection: 'row',
						flexWrap: 'wrap',
						columnGap: headerColumnGap
					},
					header.titleLine ? React.createElement(Text, { key: 'header-title' }, header.titleLine) : null,
					header.urlLine ? React.createElement(Text, { key: 'header-url' }, header.urlLine) : null
				)
				: null,
			header.detailLines.map((line, index) => React.createElement(Text, { key: `header-${index}` }, line)),
			isInitialLoading
				? React.createElement(
					Text,
					{ color: 'cyan' },
					React.createElement(LoadingSpinner),
					' Initial loading...'
				)
				: null
		),
		React.createElement(
			Box,
			{
				flexDirection: compact ? 'column' : 'row',
				flexGrow: 1,
				flexShrink: 1,
				minHeight: 0,
				overflow: 'hidden'
			},
			React.createElement(LogPanel, { tui, rows: availableLogRows }),
			isFilterVisible ? React.createElement(FilterPanel, { tui, compact, rows: availableLogRows }) : null
		),
		React.createElement(
			Box,
			{ ref: promptRef, flexDirection: 'column', flexShrink: 0, maxHeight: terminalRows, overflow: 'hidden' },
			React.createElement(PromptPanel, { tui })
		)
	);
}

export class TUI {
	constructor() {
		this.app = null;
		this.isInitialized = false;
		this.urls = {
			local: '',
			external: ''
		};
		this.commands = '';
		this.components = [];
		this.selectedComponent = null;
		this.watchMode = false;
		this.isPaused = false;
		this.isMouseEnabled = true;
		this._logHistory = [];
		this._logScrollOffset = 0;
		this._activePrompt = null;
		this._isInitialLoading = false;
		this._renderScheduled = false;
		this.commandHandler = null;
	}

	init() {
		if (!process.stdin.isTTY || !process.stdout.isTTY) {
			return;
		}
		if (this.isInitialized) {
			this._isInitialLoading = true;
			this.render();
			return;
		}

		this._isInitialLoading = true;
		this.isInitialized = true;
		this.app = renderInk(React.createElement(TUIRoot, { tui: this }), {
			exitOnCtrlC: false,
			stdin: process.stdin,
			stdout: process.stdout,
			patchConsole: false,
			alternateScreen: true,
			incrementalRendering: true
		});

		this.setMouseCaptureEnabled(this.isMouseEnabled);

		this.render();
	}

	isInitialLoading() {
		return this._isInitialLoading;
	}

	finishInitialLoading() {
		if (!this._isInitialLoading) {
			return;
		}

		this._isInitialLoading = false;
		this.render();
	}

	isMouseEscapeSequence(input) {
		if (!input || typeof input !== 'string') {
			return false;
		}

		sgrMouseRegex.lastIndex = 0;
		return sgrMouseRegex.test(input);
	}

	handleMouseData(data) {
		sgrMouseRegex.lastIndex = 0;

		let match;
		while ((match = sgrMouseRegex.exec(data)) !== null) {
			const code = Number(match[1]);
			const action = match[4];

			if ((code & 64) === 64) {
				const isScrollDown = (code & 1) === 1;
				this.scrollLogs(isScrollDown ? -3 : 3);
				continue;
			}

			const isButtonPress = action === 'M';
			const isDragEvent = (code & 32) === 32;

			if (isButtonPress && !isDragEvent) {
				this.disableMouseCapture();
				break;
			}
		}
	}

	setMouseCaptureEnabled(isEnabled) {
		if (!process.stdout?.isTTY) {
			return;
		}

		if (isEnabled) {
			process.stdout.write('\x1b[?1000h\x1b[?1002h\x1b[?1006h');
			return;
		}

		process.stdout.write('\x1b[?1000l\x1b[?1002l\x1b[?1006l');
	}

	getHeaderLayout() {
		const detailLines = [];
		const statusMessages = [];

		let titleLine = '';
		if (this.components.length > 0) {
			titleLine = styleText('gray', 'Components: ') + styleText('cyan', this.components.join(', '));
		}

		let urlLine = '';
		if (this.urls.local || this.urls.external) {
			if (this.urls.local) {
				urlLine = `${styleText('gray', 'Local:')} ${styleText('green', this.urls.local)}`;
			}
			if (this.urls.external) {
				if (urlLine) {
					urlLine += '  ';
				}
				urlLine += `${styleText('gray', 'External:')} ${styleText('green', this.urls.external)}`;
			}
		}

		if (this.commands) {
			detailLines.push(this.commands);
		}

		if (this.isPaused) {
			statusMessages.push(styleText(['bold', 'yellow'], 'PAUSED'));
		}

		if (!this.isMouseEnabled) {
			statusMessages.push(styleText(['bold', 'yellow'], 'TEXT SELECT') + styleText('yellow', ' - Press [ENTER] to enable scroll.'));
		}

		if (statusMessages.length > 0) {
			detailLines.push(statusMessages.join(styleText('gray', ' | ')));
		}

		return {
			titleLine,
			urlLine,
			detailLines
		};
	}

	setURLs(local, external) {
		this.urls.local = local;
		this.urls.external = external;
		this.render();
	}

	setCommands(commands) {
		this.commands = commands;
		this.render();
	}

	setPaused(isPaused) {
		this.isPaused = isPaused;
		this.render();
	}

	setComponents(components, watchMode = false) {
		this.components = components;
		if (!components.includes(this.selectedComponent)) {
			this.selectedComponent = null;
			this._logScrollOffset = 0;
		}
		this.watchMode = watchMode;
		this.render();
	}

	selectComponent(component) {
		if (component !== null && !this.components.includes(component)) {
			throw new Error(`Unknown log component: ${component}`);
		}
		this.selectedComponent = component;
		this._logScrollOffset = 0;
		this.render();
	}

	log(message, component = null) {
		this._logHistory.push({ message, component });
		if (!this.isInitialized) {
			log(null, message);
			return;
		}

		if (this._logScrollOffset === 0) {
			this._logScrollOffset = 0;
		}
		this.render();
	}

	getLogHistory() {
		return this._logHistory.map(entry => entry.message).join('\n');
	}

	getFilteredLogHistory() {
		return this.selectedComponent === null ? this._logHistory : this._logHistory.filter(entry => entry.component === this.selectedComponent);
	}

	getVisibleLogLines(maxRows) {
		if (maxRows <= 0) {
			return [];
		}
		const history = this.getFilteredLogHistory();
		if (history.length === 0) {
			return [this.selectedComponent ? `No ${this.selectedComponent} logs yet.` : ''];
		}

		const maxOffset = Math.max(0, history.length - maxRows);
		this._logScrollOffset = Math.max(0, Math.min(this._logScrollOffset, maxOffset));

		const endIndex = history.length - this._logScrollOffset;
		const startIndex = Math.max(0, endIndex - maxRows);
		return history.slice(startIndex, endIndex).map(entry => entry.message);
	}

	scrollLogs(delta) {
		const nextOffset = this._logScrollOffset + delta;
		const maxOffset = Math.max(0, this.getFilteredLogHistory().length - 1);
		this._logScrollOffset = Math.max(0, Math.min(nextOffset, maxOffset));
		this.render();
	}

	render() {
		if (!this.isInitialized || !this.app) {
			return;
		}
		if (this._renderScheduled) {
			return;
		}
		this._renderScheduled = true;
		setImmediate(() => {
			this._renderScheduled = false;
			if (this.isInitialized && this.app) {
				this.app.rerender(React.createElement(TUIRoot, { tui: this }));
			}
		});
	}

	dispatchCommand(input, key) {
		if (this.commandHandler) {
			Promise.resolve().then(() => this.commandHandler(input, key)).catch(error => {
				log('error', `Failed to handle watch command: ${error.message}`);
			});
		}
	}

	handlePaste(text) {
		if (this._activePrompt?.type !== 'input') {
			return;
		}
		this._activePrompt.value += sanitizePastedName(text);
		this.render();
	}

	hasPrompt() {
		return Boolean(this._activePrompt);
	}

	getPromptRenderLines() {
		if (!this._activePrompt) {
			return [];
		}

		if (this._activePrompt.type === 'menu') {
			const promptLines = [this._activePrompt.prompt];
			for (let i = 0; i < this._activePrompt.options.length; i++) {
				const isSelected = i === this._activePrompt.selectedIndex;
				const prefix = isSelected ? styleText(['bold', 'green'], '>') : ' ';
				promptLines.push(`${prefix} ${this._activePrompt.options[i]}`);
			}
			promptLines.push(styleText('gray', 'Use arrows to choose. Enter to confirm. Esc/q to cancel.'));
			return promptLines;
		}

		if (this._activePrompt.type === 'input') {
			const cursor = styleText(['bold', 'cyan'], '_');
			return [
				this._activePrompt.prompt,
				`${styleText('gray', '>')} ${this._activePrompt.value}${cursor}`,
				styleText('gray', 'Type your value, Enter to submit, Esc to cancel.')
			];
		}

		return [];
	}

	handlePromptInput(input, key) {
		if (!this._activePrompt) {
			return;
		}

		if (this._activePrompt.type === 'menu') {
			if (key.upArrow) {
				this._activePrompt.selectedIndex = (this._activePrompt.selectedIndex - 1 + this._activePrompt.options.length) % this._activePrompt.options.length;
				this.render();
				return;
			}
			if (key.downArrow) {
				this._activePrompt.selectedIndex = (this._activePrompt.selectedIndex + 1) % this._activePrompt.options.length;
				this.render();
				return;
			}
			if (key.return) {
				const selectedIndex = this._activePrompt.selectedIndex;
				const selectedValue = this._activePrompt.options[selectedIndex];
				const resolve = this._activePrompt.resolve;
				this._activePrompt = null;
				this.render();
				resolve({ value: selectedValue, index: selectedIndex });
				return;
			}
			if (key.escape || input === 'q') {
				const resolve = this._activePrompt.resolve;
				this._activePrompt = null;
				this.render();
				resolve(null);
			}
			return;
		}

		if (this._activePrompt.type === 'input') {
			if (key.return) {
				const resolve = this._activePrompt.resolve;
				const value = this._activePrompt.value;
				this._activePrompt = null;
				this.render();
				resolve(value);
				return;
			}
			if (key.escape) {
				const resolve = this._activePrompt.resolve;
				this._activePrompt = null;
				this.render();
				resolve(null);
				return;
			}
			if (key.backspace || key.delete) {
				this._activePrompt.value = Array.from(this._activePrompt.value).slice(0, -1).join('');
				this.render();
				return;
			}
			if (!key.ctrl && !key.meta && input) {
				this._activePrompt.value += input;
				this.render();
			}
		}
	}

	async showMenu(options, prompt = 'Choose an option:') {
		if (!this.isInitialized) {
			return null;
		}

		return new Promise((resolve) => {
			this._activePrompt = {
				type: 'menu',
				options,
				prompt,
				selectedIndex: 0,
				resolve
			};
			this.render();
		});
	}

	async showCreation() {
		if (!this.isInitialized) {
			return null;
		}
		return new Promise(resolve => {
			this._activePrompt = { type: 'creation', resolve };
			this.render();
		});
	}

	async showInput(prompt = 'Enter value:') {
		if (!this.isInitialized) {
			return null;
		}

		return new Promise((resolve) => {
			this._activePrompt = {
				type: 'input',
				prompt,
				value: '',
				resolve
			};
			this.render();
		});
	}

	getState() {
		return {
			urls: { ...this.urls },
			commands: this.commands,
			components: [...this.components],
			selectedComponent: this.selectedComponent,
			watchMode: this.watchMode,
			isPaused: this.isPaused,
			isMouseEnabled: this.isMouseEnabled
		};
	}

	setState(state) {
		if (state) {
			this.urls = { ...state.urls };
			this.commands = state.commands;
			this.components = [...state.components];
			this.selectedComponent = this.components.includes(state.selectedComponent) ? state.selectedComponent : null;
			this._logScrollOffset = 0;
			this.watchMode = state.watchMode;
			this.isPaused = state.isPaused;
			this.isMouseEnabled = state.isMouseEnabled ?? true;
			this.render();
		}
	}

	enableMouseCapture() {
		if (this.isMouseEnabled) {
			return;
		}
		this.isMouseEnabled = true;
		this.setMouseCaptureEnabled(true);
		this.render();
	}

	disableMouseCapture() {
		if (!this.isMouseEnabled) {
			return;
		}
		this.isMouseEnabled = false;
		this.setMouseCaptureEnabled(false);
		this.render();
	}

	async destroy() {
		if (!this.isInitialized) {
			return;
		}

		const app = this.app;
		this.app = null;
		this.isInitialized = false;

		this.setMouseCaptureEnabled(false);

		this.isMouseEnabled = true;
		this._activePrompt?.resolve(null);
		this._activePrompt = null;
		this._logScrollOffset = 0;
		this._isInitialLoading = false;

		if (app) {
			app.unmount();
			await app.waitUntilExit();
			app.cleanup();
		}

		if (process.stdout.isTTY) {
			process.stdout.write('\x1b[?25h');
			process.stdout.write('\x1b[0m');
		}
	}
}

const tui = new TUI();
export default tui;
