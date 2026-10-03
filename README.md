## Install

```sh
npm install sdc-build-wp
sdc-build-wp # build
sdc-build-wp --watch # build and watch
sdc-build-wp --watch --builds=style,scripts # comma-seperated list of components to include
sdc-build-wp --help
```

## Caching

Caching speeds up subsequent builds by only rebuilding files that have changed or whose dependencies have changed.

Cache manifest updates are batched during the initial build and coalesced over 100ms in watch mode. Writes are serialized and atomic, and pending updates are flushed before restarting or exiting.

Script dependency graphs are refreshed after lint fixes, once per processed entry, and reused for cache checks. Watch rebuilds refresh only affected entries when the changed file is already in the graph.

Dependency hashes are read concurrently, with duplicate in-flight reads shared across entries. `buildConcurrency.cache` controls the number of concurrent dependency checks per entry (default: 8). These lightweight reads do not consume compilation slots.

```sh
sdc-build-wp --no-cache        # Disable caching for this build
sdc-build-wp --clear-cache     # Clear all cached data
```

## Configuration

Optional concurrency caps can be set in `.sdc-build-wp/config.json` to keep expensive builds parallel without oversubscribing the machine. By default, concurrency is based on available CPU cores (with a minimum, even on single-core machines, since builds spend meaningful time on process startup/IO rather than pure CPU work).

`total` limits combined style/script compilation, linting, block compilation, image processing, and font copying across components, including watch rebuilds. It defaults to the `default` cap. Component caps apply in addition to this shared budget; directory discovery and dependency traversal do not hold build slots.

```json
{
	"buildConcurrency": {
		"default": 10,
		"total": 10,
		"style": 10,
		"scripts": 10,
		"blocks": 10,
		"images": 10,
		"cache": 8
	}
}
```

## Watch

The initial-loading spinner uses Ink's shared animation scheduler and stops when loading finishes.

While watch is enabled, use the following keyboard commands to control the build process:

```sh
[r]     Restart build process
[c]     Clear cache and restart
[p]     Pause/Resume watching
[n]     New component
[f]     Toggle filter
[/]     Search logs
[q]     Quit
````

## Develop

Develop locally with the following command from within the test project directory:

```
node ~/sites/sdc/sdc-build-wp/index.js --watch
# or
sdc-build-wp-local --watch
```

## Release

Run `npm run test:coverage` for the full suite with Node's built-in line, branch,
and function coverage report for `lib`. CLI integration subprocesses contribute
to the report; external PHP tooling and generated bundles are not measured.
Additional unit tests cover configuration validation, dependency resolution,
asset processing, HTML formatting, and block build/cache/queue failure handling.
Block orchestration tests stub webpack execution rather than compile a full block.
Cache lifecycle, Sass dependency updates, and watcher event routing also have
regression coverage. Watcher unit tests simulate events without starting servers.

Run the fixture directly with `npm run build:theme`, or run its build and PHP
integration tests with `npm run test:theme`. The direct build writes ignored
output and cache files inside the fixture and processes styles, scripts, and
images; PHP linting is exercised by `test:theme`. Pass extra build options with
`npm run build:theme -- --no-cache`.
Use `npm run build:theme:watch` to watch the fixture and rebuild styles, scripts,
and images on changes without starting BrowserSync. Quit with `q` or Ctrl+C.

`npm test` includes a real CLI build of the theme in `tests/fixtures/theme`.
Tests build a temporary copy, verify Sass, JavaScript, SVG output and source maps,
and check cache reuse, dependency changes, missing outputs, and `--no-cache`.
The fixture stays unchanged. A block render PHP fixture also tests discovery,
linting, formatting, and rejection of syntax and coding-standard errors through
the PHP component. Run `composer install` and have PHP available before running
the full suite; release CI installs these tools automatically. No WordPress
server is required. Server-free file watching is tested; block compilation and
interactive terminal rendering are not covered by the fixture tests.

Use `npm run release:patch`, `npm run release:minor`, or `npm run release:major`.
All tests must pass before the release script changes the version, commits, tags,
or pushes. Tagged CI releases also require the full test suite to pass before
creating the GitHub release or publishing to npm.
