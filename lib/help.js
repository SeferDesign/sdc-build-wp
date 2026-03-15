import project from './project.js';
import { styleText } from 'node:util';
import log from './logging.js';

export default function() {
	log(null, `
${styleText(['bold', 'blue'], 'SDC Build WP')} - Custom WordPress build process

${styleText('yellow', 'Usage:')} sdc-build-wp [options] [arguments]

${styleText('yellow', 'Options:')}
  ${styleText('green', '-h, --help')}           Show this help message and exit
  ${styleText('green', '-v, --version')}        Show version number and exit
  ${styleText('green', '-w, --watch')}          Build and watch for changes
  ${styleText('green', '-b, --builds BUILDS')}  Build with specific components (comma-separated)
  ${styleText('green', '--no-cache')}           Disable build caching for this run
  ${styleText('green', '--clear-cache')}        Clear all cached data and exit

${styleText('yellow', 'Available Components:')}
${Object.entries(project.components).map(([key, component]) => {
		return `  ${styleText('cyan', key.padEnd(12))} ${component.description}`;
	}).join('\n')}

${styleText('yellow', 'Examples:')}
  ${styleText('dim', '# Basic build')}
  sdc-build-wp

  ${styleText('dim', '# Build and watch for changes')}
  sdc-build-wp --watch

  ${styleText('dim', '# Build only specific components')}
  sdc-build-wp --watch --builds=style,scripts

  ${styleText('dim', '# Build without cache')}
  sdc-build-wp --no-cache

  ${styleText('dim', '# Clear cache and exit')}
  sdc-build-wp --clear-cache

${styleText('yellow', 'Watch Mode Controls:')}
  ${styleText('green', '[r]')} Restart build process
  ${styleText('green', '[c]')} Clear cache
  ${styleText('green', '[p]')} Pause/Resume watching
  ${styleText('green', '[n]')} New component
  ${styleText('green', '[q]')} Quit and exit

${styleText('yellow', 'Configuration:')}
  Place your configuration in ${styleText('cyan', `${project.sdcDirName}/${project.configFileName}`)}
  See documentation for available options.
`);
}
