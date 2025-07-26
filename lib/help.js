import project from './project.js';

export default function() {
	console.log(`
Usage: sdc-build-wp [options] [arguments]

Options:
	-h, --help           Show help message and exit
	-v, --version        Version
	-w, --watch          Build and watch
	-b, --builds BUILDS  Build with specific components
	--no-cache           Disable build caching
	--clear-cache        Clear build cache and exit

Components:

${Object.entries(project.components).map(([key, component]) => {
	return `${key}\t\t${component.description}\r\n`;
}).join('')}
Examples:

sdc-build-wp
sdc-build-wp --watch
sdc-build-wp --watch --builds=style,scripts
sdc-build-wp --no-cache
sdc-build-wp --clear-cache

While watch is enabled, use the following keyboard commands to control the build process:

	[r]     Restart
	[p]     Pause/Resume
	[q]     Quit
`);
}
