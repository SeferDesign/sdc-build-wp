import BaseComponent from './base.js';
import { create as bsCreate } from 'browser-sync';

class ServerComponent extends BaseComponent {

	constructor() {
		super();
		this.slug = 'server';
		this.server = bsCreate();
	}

	async init() {
		//
	}

	start() {
		let watchedFiles = [
			this.project.path + '/dist/**/*',
			this.project.path + '/**/*.html',
			this.project.path + '/**/*.json',
		];
		if (!this.project.shouldPHPLint) {
			watchedFiles.push(this.project.path + '/**/*.php');
		}
		let bsOptions = {
			logPrefix: '',
			port: this.project.package.sdc?.port || 3000,
			proxy: this.project.package.sdc?.browsersync?.localProxyURL,
			files: watchedFiles,
			reloadDelay: 250,
			reloadDebounce: 1000,
			watchEvents: this.project.package.sdc?.browsersync?.watchEvents || ['add', 'change', 'unlink', 'addDir', 'unlinkDir'],
			open: this.project.package.sdc?.open || false,
			https: (process.env.SSL_KEY_PATH && process.env.SSL_CRT_PATH ? {
				key: process.env.SSL_KEY_PATH,
				cert: process.env.SSL_CRT_PATH
			} : false),
			ui: false,
			tunnel: this.project.package.sdc?.browsersync?.tunnel,
			notify: {
				styles: {
					pointerEvents: 'none',
					userSelect: 'none',
					opacity: '0.5',
					top: 'auto',
					bottom: '0',
					borderRadius: '5px 0px 0px'
				}
			}
		};
		if (this.project.package.sdc?.browsersync?.location == 'end') {
			bsOptions.snippetOptions = {
				rule: {
					match: /<\/body>/i,
					fn: function (snippet, match) {
						return snippet + match;
					}
				}
			};
		}
		this.server.init(bsOptions);
	}

	async watch() {
		this.start();
	}

}

export { ServerComponent as default }
