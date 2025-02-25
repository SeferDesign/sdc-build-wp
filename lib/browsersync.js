import project from '../lib/project.js';
import { create as bsCreate } from 'browser-sync';
import { shouldPHPLint } from './php.js';

export const browserSync = bsCreate();

const buildBrowserSync = () => {
	let watchedFiles = [
		project.path + '/dist/**/*',
		project.path + '/**/*.html',
		project.path + '/**/*.json',
	];
	if (!shouldPHPLint) {
		watchedFiles.push(project.path + '/**/*.php');
	}
	let bsOptions = {
		logPrefix: '',
		port: project.package.sdc?.port || 3000,
		proxy: project.package.sdc?.browsersync?.localProxyURL,
		files: watchedFiles,
		reloadDelay: 250,
		reloadDebounce: 1000,
		watchEvents: project.package.sdc?.browsersync?.watchEvents || ['add', 'change', 'unlink', 'addDir', 'unlinkDir'],
		open: project.package.sdc?.open || false,
		https: (process.env.SSL_KEY_PATH && process.env.SSL_CRT_PATH ? {
			key: process.env.SSL_KEY_PATH,
			cert: process.env.SSL_CRT_PATH
		} : false),
		ui: false,
		tunnel: project.package.sdc?.browsersync?.tunnel,
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
	if (project.package.sdc?.browsersync?.location == 'end') {
		bsOptions.snippetOptions = {
			rule: {
				match: /<\/body>/i,
				fn: function (snippet, match) {
					return snippet + match;
				}
			}
		};
	}
	browserSync.init(bsOptions);
};

export default buildBrowserSync;
