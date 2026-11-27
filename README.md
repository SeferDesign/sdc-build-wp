# sdc-build-wp

A custom build process for WordPress themes and plugins: Sass and script bundling, block compilation, image and font processing, PHP/HTML formatting, WordPress theme and block validation, and a live-reloading dev server.

## Quick start

```sh
npm install sdc-build-wp
sdc-build-wp init                              # scaffold .sdc-build-wp/config.json and the _src folders
sdc-build-wp                                   # build
sdc-build-wp --watch                           # build and watch
sdc-build-wp --watch --builds=style,scripts    # comma-separated list of components to include
sdc-build-wp --ci                              # strict production build for pipelines
sdc-build-wp doctor                            # diagnose the local setup
sdc-build-wp --help
```

Requires Node 24 or newer. PHP formatting needs PHP 7.4+ on your `PATH`.

## Components

| Component | What it does |
| --- | --- |
| `style` | Lint and process Sass (`_src/style` → `dist/style`) |
| `scripts` | Lint and bundle scripts with esbuild (`_src/scripts` → `dist/scripts`) |
| `blocks` | Compile the theme's WordPress blocks |
| `images` | Compress images and optimize SVGs |
| `fonts` | Copy font files |
| `php` | Format and lint PHP files |
| `html` | Format HTML files |
| `server` | Dev proxy server with live reloading |
| `errors` | Tail the PHP error log |
| `cache` | Build caching |

Limit a run with `--builds=style,scripts`.

## Configuration

Settings go in `.sdc-build-wp/config.json`; the schema gives editor autocomplete and validation:

```json
{
	"$schema": "../node_modules/sdc-build-wp/config.schema.json",
	"browsersync": {
		"localProxyURL": "https://example.test"
	}
}
```

## Documentation

| Guide | Covers |
| --- | --- |
| [Configuration](docs/configuration.md) | Every setting, concurrency caps, legacy settings |
| [Project setup](docs/project-setup.md) | `init`, `doctor` and `doctor --fix` |
| [Watch mode](docs/watch.md) | Keyboard commands, signals, config reloads |
| [Caching](docs/caching.md) | How rebuilds are skipped and invalidated |
| [Production and CI builds](docs/ci.md) | `--production`, `--ci`, `--json`, exit codes |
| [Blocks](docs/blocks.md) | The block build pipeline and timeout |
| [WordPress validation](docs/validation.md) | Version detection, schemas, relaxing validation |
| [AI agents](docs/agents.md) | Installing the packaged agent skill |
| [Developing and releasing](docs/contributing.md) | Local development, tests, releases |
