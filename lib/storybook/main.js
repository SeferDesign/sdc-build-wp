import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWordPressTheme } from './wordpress.js';

const themePath = process.env.SDC_STORYBOOK_THEME;
const sourceURL = process.env.SDC_STORYBOOK_SOURCE;
const directory = path.dirname(fileURLToPath(import.meta.url));

export default {
	framework: { name: path.dirname(fileURLToPath(import.meta.resolve('@storybook/html-vite/package.json'))), options: {} },
	stories: [
		path.join(directory, 'theme.stories.js'),
		path.join(themePath, '_src/style/**/*.stories.@(js|ts)')
	],
	core: { disableTelemetry: true },
	async viteFinal(config) {
		config.plugins.push({
			name: 'sdc-wordpress-theme',
			configureServer(server) {
				server.middlewares.use('/sdc-wordpress-theme', async (request, response) => {
					response.setHeader('Content-Type', 'application/json');
					response.setHeader('Cache-Control', 'no-store');
					try {
						response.end(JSON.stringify(await loadWordPressTheme(themePath, sourceURL)));
					} catch (error) {
						server.config.logger.error(`WordPress Storybook styles: ${error.message}`);
						response.statusCode = 502;
						response.end(JSON.stringify({ error: error.message }));
					}
				});
				server.watcher.add(themePath);
				const refresh = file => {
					const relative = path.relative(themePath, file);
					if (!relative.startsWith('..') && !relative.split(path.sep).some(part => ['node_modules', 'vendor', '.git', '.sdc-build-wp'].includes(part)) && /\.(css|json|php)$/.test(file)) {
						server.ws.send({ type: 'full-reload' });
					}
				};
				server.watcher.on('add', refresh);
				server.watcher.on('change', refresh);
				server.watcher.on('unlink', refresh);
			}
		});
		config.server = {
			...config.server,
			fs: { ...config.server?.fs, allow: [...(config.server?.fs?.allow || []), themePath, directory] }
		};
		return config;
	}
};
