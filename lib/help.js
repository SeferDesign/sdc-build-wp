import project from './project.js';
import chalk from 'chalk';
import log from './logging.js';

export default function() {
	log(null, `
${chalk.bold.blue('SDC Build WP')} - Custom WordPress build process

${chalk.yellow('Usage:')} sdc-build-wp [options] [arguments]

${chalk.yellow('Options:')}
  ${chalk.green('-h, --help')}           Show this help message and exit
  ${chalk.green('-v, --version')}        Show version number and exit
  ${chalk.green('-w, --watch')}          Build and watch for changes
  ${chalk.green('-b, --builds BUILDS')}  Build with specific components (comma-separated)
  ${chalk.green('--no-cache')}           Disable build caching for this run
  ${chalk.green('--clear-cache')}        Clear all cached data and exit

${chalk.yellow('Available Components:')}
${Object.entries(project.components).map(([key, component]) => {
		return `  ${chalk.cyan(key.padEnd(12))} ${component.description}`;
	}).join('\n')}

${chalk.yellow('Examples:')}
  ${chalk.dim('# Basic build')}
  sdc-build-wp

  ${chalk.dim('# Build and watch for changes')}
  sdc-build-wp --watch

  ${chalk.dim('# Build only specific components')}
  sdc-build-wp --watch --builds=style,scripts

  ${chalk.dim('# Build without cache')}
  sdc-build-wp --no-cache

  ${chalk.dim('# Clear cache and exit')}
  sdc-build-wp --clear-cache

${chalk.yellow('Watch Mode Controls:')}
  ${chalk.green('[r]')} Restart build process
  ${chalk.green('[c]')} Clear cache
  ${chalk.green('[p]')} Pause/Resume watching
  ${chalk.green('[n]')} New component
  ${chalk.green('[q]')} Quit and exit

${chalk.yellow('Configuration:')}
  Place your configuration in ${chalk.cyan(`${project.sdcDirName}/${project.configFileName}`)}
  See documentation for available options.
`);
}
