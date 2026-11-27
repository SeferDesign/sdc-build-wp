# Developing and releasing

## Develop locally

Develop locally with the following command from within the test project directory:

```sh
node ~/sites/sdc/sdc-build-wp/index.js --watch
# or
sdc-build-wp-local --watch
```

## Tests

```sh
npm test                  # the full suite
npm run test:coverage     # with Node's built-in line, branch and function coverage for lib
npm run test:theme        # the fixture's build and PHP integration tests
```

Run `composer install` and have PHP available before running the full suite; release CI installs these tools automatically. No WordPress server is required.

### Coverage

`test:coverage` reports on `lib`. CLI integration subprocesses contribute to the report; external PHP tooling and generated bundles are not measured. Unit tests cover configuration validation, dependency resolution, asset processing, HTML formatting, and block build/cache/queue failure handling. Block orchestration unit tests stub webpack execution; CLI integration also compiles a real block and verifies its metadata and dependency output. Cache lifecycle, Sass dependency updates, and watcher event routing also have regression coverage. Watcher unit tests simulate events without starting servers.

### Helpers

Shared helpers live in `tests/helpers/`:

- `makeTheme` copies the fixture theme (optionally with a fake WordPress install and offline schemas).
- `run` executes the CLI and resolves with its exit code and output.
- `startWatch` drives a real watch session.
- `withProject` points the shared project singleton at a temporary directory for component-level tests.

Lifecycle behavior (signals, config reload, legacy migration, `init`/`doctor --fix`, CI modes, interactive creation commands and crash handlers) is tested against real processes. Interactive terminal rendering and the `[c]`/`[r]`/`[q]` key handlers are the main parts that are not.

Tests should not depend on the developer's environment: terminal colors, `NODE_ENV` and exported `SSL_KEY_PATH`/`SSL_CRT_PATH` can all differ from CI.

### The fixture theme

`npm test` includes a real CLI build of the theme in `tests/fixtures/theme`. Tests build a temporary copy, verify Sass, JavaScript, SVG output and source maps, and check cache reuse, dependency changes, missing outputs, and `--no-cache`. The fixture stays unchanged. A block render PHP fixture also tests discovery, quiet formatting, acceptance of coding-standard violations, and rejection of syntax errors through the PHP component. Server-free file watching, recovery from broken imports, failure exit codes, invalid configuration, and failed output writes are tested. Interactive terminal rendering is not covered by the fixture tests.

`test:theme` creates temporary WordPress version metadata and offline schema caches; no installed WordPress site or network access is required.

Direct fixture commands (`npm run build:theme` and `npm run build:theme:watch`) require this checkout to be within a detectable WordPress installation. The direct build writes ignored output and cache files inside the fixture and processes styles, scripts, and images; PHP linting is exercised by `test:theme`. Pass extra build options with `npm run build:theme -- --no-cache`. Use `npm run build:theme:watch` to watch the fixture and rebuild styles, scripts, and images on changes without starting BrowserSync. Quit with `q` or Ctrl+C.

## Release

Use `npm run release:patch`, `npm run release:minor`, or `npm run release:major`. All tests must pass before the release script changes the version, commits, tags, or pushes. Tagged CI releases also require the full test suite to pass before creating the GitHub release or publishing to npm.

Pushes to `master` and pull requests run the test suite through `.github/workflows/ci.yml`.

The published package is limited by the `files` list in `package.json`; add new runtime files there.
