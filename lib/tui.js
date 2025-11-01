import blessed from 'blessed';
import chalk from 'chalk';
import log from './logging.js';

class TUI {
	constructor() {
		this.screen = null;
		this.headerBox = null;
		this.logBox = null;
		this.isInitialized = false;
		this.urls = {
			local: '',
			external: ''
		};
		this.commands = '';
		this.components = [];
		this.watchMode = false;
		this.isPaused = false;
		this._logHistory = [];
	}

	init() {
		if (this.isInitialized) {
			// If already initialized, redraw the header to reflect current state
			this.updateHeader();
			this.render();
			return;
		}

		if (process.stdout.isTTY) {
			process.stdout.write('\x1b[?25h');
			process.stdout.write('\x1b[0m');
		}

		this.screen = blessed.screen({
			smartCSR: true,
			fullUnicode: true,
			title: 'SDC Build WP',
			input: process.stdin,
			output: process.stdout
		});

		this.headerBox = blessed.box({
			top: 0,
			left: 0,
			width: '100%',
			height: 5,
			content: '',
			tags: true,
			style: {
				fg: 'white',
				bg: 'black',
				border: {
					fg: 'blue'
				}
			},
			border: {
				type: 'line',
				bottom: true
			},
			shrink: false,
			scrollable: false
		});

		this.logBox = blessed.log({
			top: 5,
			left: 0,
			width: '100%',
			height: '100%-5',
			tags: true,
			scrollable: true,
			alwaysScroll: true,
			scrollbar: {
				ch: ' ',
				track: {
					bg: 'blue'
				},
				style: {
					inverse: true
				}
			},
			mouse: true,
			keys: true,
			vi: true,
			style: {
				fg: 'white',
				bg: 'black'
			}
		});

		this.screen.append(this.logBox);
		this.screen.append(this.headerBox);

		this.screen.on('resize', () => {
			this.updateHeader();
			this.screen.render();
		});

		this.screen.key(['escape', 'q', 'C-c'], () => {
			return false;
		});

		this.screen.key(['enter', 'return'], () => {
			this.logBox.log('');
			this.screen.render();
		});

		this.screen.key(['down'], () => {
			this.logBox.scroll(1);
			this.screen.render();
		});

		this.screen.key(['up'], () => {
			this.logBox.scroll(-1);
			this.screen.render();
		});

		this.screen.key(['pagedown'], () => {
			this.logBox.scroll(this.logBox.height);
			this.screen.render();
		});

		this.screen.key(['pageup'], () => {
			this.logBox.scroll(-this.logBox.height);
			this.screen.render();
		});

		this.updateHeader();
		this.screen.render();

		this.isInitialized = true;
	}

	updateHeader() {
		if (!this.isInitialized) {
			return;
		}

		const lines = [];

		let titleLine = ' ' + chalk.bold.blue('SDC Build WP');
		if (this.isPaused) {
			titleLine += chalk.bold.yellow(' [PAUSED]');
		}
		if (this.components.length > 0) {
			titleLine += chalk.gray(' [') + chalk.cyan(this.components.join(', ')) + chalk.gray(']');
		}
		lines.push(titleLine);

		if (this.urls.local || this.urls.external) {
			let urlLine = ' ';
			if (this.urls.local) {
				urlLine += `Local: ${chalk.green(this.urls.local)}`;
			}
			if (this.urls.external) {
				if (urlLine.length > 1) urlLine += '  ';
				urlLine += `External: ${chalk.green(this.urls.external)}`;
			}
			lines.push(urlLine);
		} else {
			lines.push(' ');
		}

		if (this.commands) {
			lines.push(' ' + this.commands);
		} else {
			lines.push(' ');
		}

		lines.push(' ');

		this.headerBox.setContent(lines.join('\n'));
	}

	setURLs(local, external) {
		this.urls.local = local;
		this.urls.external = external;
		this.updateHeader();
		this.render();
	}

	setCommands(commands) {
		this.commands = commands;
		this.updateHeader();
		this.render();
	}

	setPaused(isPaused) {
		this.isPaused = isPaused;
		this.updateHeader();
		this.render();
	}

	setComponents(components, watchMode = false) {
		this.components = components;
		this.watchMode = watchMode;
		this.updateHeader();
		this.render();
	}

	log(message) {
		this._logHistory.push(message);
		if (!this.isInitialized) {
			log(null, message);
			return;
		}
		this.logBox.log(message);
		this.render();
	}

	getLogHistory() {
		return this._logHistory.join('\n');
	}

	render() {
		if (this.isInitialized && this.screen) {
			this.screen.render();
		}
	}

	async showMenu(options, prompt = 'Choose an option:') {
		return new Promise((resolve) => {
			const menu = blessed.list({
				parent: this.screen,
				top: 'center',
				left: 'center',
				width: '50%',
				height: options.length + 4,
				label: ` ${prompt} `,
				items: options,
				keys: true,
				mouse: true,
				border: 'line',
				style: {
					fg: 'white',
					bg: 'black',
					border: { fg: 'blue' },
					selected: { bg: 'blue', fg: 'white' }
				}
			});
			menu.focus();
			const stopLogScroll = (ch, key) => {
				if (['up', 'down', 'pagedown', 'pageup'].includes(key.name)) {
					return false;
				}
			};
			this.logBox.ignoreKeys = true;
			menu.on('detach', () => {
				this.logBox.ignoreKeys = false;
			});
			menu.on('keypress', stopLogScroll);
			this.screen.render();
			menu.on('select', (item, idx) => {
				menu.destroy();
				this.screen.render();
				resolve({ value: item.getText(), index: idx });
			});
			menu.on('cancel', () => {
				menu.destroy();
				this.screen.render();
				resolve(null);
			});
			menu.key(['escape', 'q'], () => {
				menu.emit('cancel');
			});
		});
	}

	async showInput(prompt = 'Enter value:') {
		return new Promise((resolve) => {
			const box = blessed.box({
				parent: this.screen,
				top: 'center',
				left: 'center',
				width: '50%',
				height: 5,
				label: ` ${prompt} `,
				border: 'line',
				style: {
					fg: 'white',
					bg: 'black',
					border: { fg: 'blue' }
				}
			});
			const input = blessed.textbox({
				parent: box,
				top: 2,
				left: 2,
				width: '90%',
				height: 1,
				inputOnFocus: true,
				style: {
					fg: 'white',
					bg: 'black',
					focus: { bg: 'blue' }
				}
			});
			input.focus();
			this.screen.render();
			input.on('submit', (value) => {
				box.destroy();
				this.screen.render();
				resolve(value);
			});
			input.on('cancel', () => {
				box.destroy();
				this.screen.render();
				resolve(null);
			});
			input.key(['escape', 'q'], () => {
				input.emit('cancel');
			});
		});
	}

	getState() {
		return {
			urls: { ...this.urls },
			commands: this.commands,
			components: [...this.components],
			watchMode: this.watchMode,
			isPaused: this.isPaused
		};
	}

	setState(state) {
		if (state) {
			this.urls = { ...state.urls };
			this.commands = state.commands;
			this.components = [...state.components];
			this.watchMode = state.watchMode;
			this.isPaused = state.isPaused;
			this.updateHeader();
			this.render();
		}
	}

	destroy() {
		if (this.isInitialized && this.screen) {
			if (this.screen.program) {
				this.screen.program.showCursor();
				this.screen.program.normalBuffer();
				this.screen.program.reset();
			}

			this.screen.destroy();
			this.isInitialized = false;
			this.screen = null;
			this.headerBox = null;
			this.logBox = null;

			if (process.stdout.isTTY) {
				process.stdout.write('\x1b[?25h');
				process.stdout.write('\x1b[0m');
				process.stdout.write('\x1b[2J');
				process.stdout.write('\x1b[H');
			}
		}
	}
}

const tui = new TUI();
export default tui;
