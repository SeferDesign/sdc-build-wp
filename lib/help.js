import project from './project.js';
import { styleText } from 'node:util';
import log from './logging.js';

export default function() {
	log(null, `
${styleText(['bold', 'blue'], 'SDC Build WP')}${styleText('gray', ` v${project.version}`)} - Custom WordPress build process

${styleText('yellow', 'Usage:')} sdc-build-wp [options] [arguments]

${styleText('yellow', 'Options:')}
  ${styleText('green', '-h, --help')}           Show this help message and exit
  ${styleText('green', '-v, --version')}        Show version number and exit
  ${styleText('green', '-w, --watch')}          Build and watch for changes
  ${styleText('green', '-b, --builds BUILDS')}  Build with specific components (comma-separated)
  ${styleText('green', '--no-cache')}           Disable build caching for this run
  ${styleText('green', '--clear-cache')}        Clear all cached data and exit
  ${styleText('green', '--production')}         Production build: NODE_ENV=production, no source maps
  ${styleText('green', '--ci')}                 Production build for CI: no auto-fixing, warnings fail the build
  ${styleText('green', '--json')}               Print a machine-readable JSON summary on stdout (logs go to stderr)
  ${styleText('green', '--skip-validation')}    Skip WordPress theme/block validation (no schema download)
  ${styleText('green', '--doctor')}             Diagnose local setup without building
  ${styleText('green', '--fix')}                With doctor: create the missing config and source directories
  ${styleText('green', 'init [--force]')}       Scaffold .sdc-build-wp/config.json and the _src folders
  ${styleText('green', 'agents [reference|copy]')}  Install AI agents helpers into this project

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

  ${styleText('dim', '# Set up a new project, or repair a broken setup')}
  sdc-build-wp init
  sdc-build-wp doctor --fix

  ${styleText('dim', '# Add AI agent guidance to this project')}
  sdc-build-wp agents

${styleText('yellow', 'Watch Mode Controls:')}
  ${styleText('green', '[r]')} Restart build process
  ${styleText('green', '[c]')} Clear cache and restart
  ${styleText('green', '[p]')} Pause/Resume watching
  ${styleText('green', '[n]')} New component
  ${styleText('green', '[i]')} Show build information
  ${styleText('green', '[f]')} Toggle Filter (show and focus, or hide)
  ${styleText('green', '[/]')} Search logs (Enter keeps query; Escape restores previous search)
  ${styleText('green', '[q]')} Quit and exit
  ${styleText('green', '[Tab/Shift+Tab]')} Switch log/Filter panels
  ${styleText('green', '[Arrows]')} Scroll logs or select a component log filter
  ${styleText('green', '[Escape]')} Reset component filter or cancel a prompt

${styleText('yellow', 'Configuration:')}
  Place your configuration in ${styleText('cyan', `${project.sdcDirName}/${project.configFileName}`)}
  See documentation for available options.
`);
}
