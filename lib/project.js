import { readFile } from 'fs/promises';

let project = {
	path: process.cwd(),
	package: JSON.parse(await readFile(new URL(process.cwd() + '/package.json', import.meta.url))),
	globs: {},
	entries: {},
	files: {
		sass: [],
		js: []
	}
};

project.paths = {
	theme: {
		json: `${project.path}/theme.json`,
		scss: `${project.path}/_src/style/partials/_theme.scss`
	},
	nodeModules: `${project.path}/node_modules`,
	composer: {
		vendor: `${project.path}/vendor`
	},
	images: project.package?.sdc?.imagesPath || `${project.path}/_src/images`,
	errorLog: process.env.ERROR_LOG_PATH || project.package.sdc?.error_log_path || '../../../../../logs/php/error.log'
};

project.chokidarOpts = {
	ignoreInitial: true,
	ignored: [
		project.paths.nodeModules,
		project.paths.composer.vendor,
		project.paths.theme.scss
	]
};

export default project;
