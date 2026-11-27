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

Sass dependency tracking follows nested `@use`, `@forward` and `@import` statements (including comma lists, partials and `index` files). Script tracking follows static, side-effect and re-export imports, dynamic `import()` and `require()`. Optimized images are cached too. The manifest is tied to the build environment, so switching between development and `NODE_ENV=production` discards cached entries instead of reusing the other mode's output.

The import scanner only predicts dependencies, so each successful build also records the files the compiler reports it actually loaded (Sass `loadedUrls`, esbuild's metafile). This covers `meta.load-css()`, bundled `node_modules` packages and aliased paths, and those files feed watch-mode rebuilds as well as cache checks.

Dependency hashes are read concurrently, with duplicate in-flight reads shared across entries. `buildConcurrency.cache` controls the number of concurrent dependency checks per entry (default: 8). These lightweight reads do not consume compilation slots.

```sh
sdc-build-wp --no-cache        # Disable caching for this build
sdc-build-wp --clear-cache     # Clear all cached data
```

## Production and CI builds

```sh
sdc-build-wp --production         # NODE_ENV=production: no source maps, production block builds
sdc-build-wp --ci                 # --production plus strict checks for pipelines
sdc-build-wp --ci --json          # machine-readable result on stdout
```

`--production` sets `NODE_ENV=production` for the whole run, so output never
reuses cached development files (the cache is keyed by environment) and no
source maps are written.

`--ci` implies `--production` and makes the run safe for pipelines. Style and
script lint only check, never rewriting sources. Lint issues that would have been
auto-fixed, and any other warning (for example an undetectable WordPress version,
which `--skip-validation` or `wordpressVersionCommand` resolves), exit with status
`1`. Unfixable Stylelint errors fail every one-shot build, matching script lint
errors. `--ci` and `--json` run a single build and cannot be combined with `--watch`.

`--json` keeps stdout for one JSON document and writes all log output to stderr:

```json
{ "success": true, "version": "5.13.0", "durationMs": 1840, "components": ["cache", "style", "scripts"], "errors": [], "warnings": [] }
```

`errors` and `warnings` list `{ "component", "message" }` objects without terminal colors.

## Configuration

One-shot builds exit with status `1` when a component reports an error, including
script lint errors remaining after automatic fixes. Watch mode reports errors
without exiting so subsequent saves can recover.

Optional concurrency caps can be set in `.sdc-build-wp/config.json` to keep expensive builds parallel without oversubscribing the machine. By default, concurrency is based on available CPU cores (with a minimum, even on single-core machines, since builds spend meaningful time on process startup/IO rather than pure CPU work).

Add `"$schema": "../node_modules/sdc-build-wp/config.schema.json"` to that file
for editor autocomplete and validation. The same schema validates configuration
at startup. Unknown settings, malformed entry arrays, invalid proxy URLs, and
non-positive or fractional concurrency caps are rejected. Unknown `--builds`
component names are also rejected before building.

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

## Blocks

Every block build, whether the initial batch, a watch rebuild or a newly created
block, runs through one pipeline: cache preflight, an in-process
`@wordpress/scripts` webpack compile, then caching of successful builds. A failed
or timed-out block is reported on its own and never fails the others. Alongside
the source files it scans, each build records the project files webpack actually
read, so shared imports from `_src` trigger rebuilds of the blocks that use them.

Each block's compile is limited to 60 seconds (waiting for a build slot does not
count). Raise it for large blocks:

```json
{
	"blocks": {
		"timeout": 120
	}
}
```

## WordPress Validation

Source theme and block validation runs automatically before every build and
when source metadata changes in watch mode. By default it has no standalone
command, version/path override, compiled-output mode, or refresh flag.

For CI or offline machines where WordPress or the schema service is unavailable,
validation can be relaxed without hiding it from normal local builds:

```sh
sdc-build-wp --skip-validation   # skip for this run; no version detection or schema download
```

```json
{
	"validation": {
		"enabled": true,
		"failOn": "never"
	}
}
```

`validation.enabled: false` skips validation entirely, like the flag, and
`validation.failOn: "never"` still runs it but reports every problem (including
schema download failures) as warnings so the build continues and exits normally.
The default is `{ "enabled": true, "failOn": "error" }`.
Validation reads the nearest ancestor `wp-includes/version.php` without running
PHP or bootstrapping WordPress. Symlinked themes also search their real path.
When local version metadata is missing or inaccessible, detection falls back to
`wordpressVersionCommand` if configured, otherwise the WordPress generator meta
tag served by `browsersync.localProxyURL`. Site upgrades automatically select
schemas for the detected version. A configured command takes precedence over
HTTP metadata, but a readable local version file always takes precedence.

Proxy detection has a five-second timeout and requires an exposed WordPress
generator meta tag; hardened sites often remove it, and page caches can serve a
stale value. Asset query strings and public REST responses are not reliable core
version sources. Use a command for containerized or restricted installations:

```json
{
	"wordpressVersionCommand": "docker compose exec -T wordpress wp core version --path=/var/www/html --allow-root",
	"browsersync": {
		"localProxyURL": "https://example.loc"
	}
}
```

Adjust the service name, WordPress path, and WP-CLI options for the instance.
The command runs through the system shell in the project directory with its
existing environment. It must print only the version (for example `6.8.3`) on
stdout; diagnostics can go to stderr. It has a ten-second timeout and a 64 KiB
output limit. A configured command that fails or prints invalid output is an
error, not a reason to silently fall back to HTTP. Only use trusted project
configuration: this setting executes code. HTTPS proxy detection verifies TLS;
use the command when local certificates cannot be trusted by Node.

Official theme and block schemas are downloaded from
`https://schemas.wp.org/wp/<major.minor>/` on first use. Patch releases share
their release's schema, for example WordPress 6.8.3 uses 6.8. No WordPress schemas
are bundled. Schemas are cached per project in `.sdc-build-wp/cache/schemas/`
and reused offline. This location is fixed and covered by the existing cache
ignore rule. Downloads time out after ten seconds, are checked before caching,
and are written atomically. `--clear-cache` removes schemas along with build
cache data; the next build needs internet access to download them again.
The watch-mode `c` command stops watchers and pending validation before clearing
the cache, then downloads schemas during the restarted build. `--no-cache`
disables compilation and validation-result caching but still reuses downloaded
schemas for mandatory validation.
Missing schemas or failed initial downloads are errors; validation never
silently substitutes another version. Corrupt cached schemas are downloaded again.
Prereleases use their major/minor URL, which must exist on the schema service.

Checks cover schema errors with JSON property paths, local fonts and images,
Sass token collisions and invalid variable names, duplicate block names, and
missing block render files. Source-only CSS and JavaScript references may point
at future compiled files; missing files for these deferred references are not
warnings. Missing required render, variation, font, and image files remain errors.
Generated block build directories
are excluded; only source metadata is checked.
Missing declared templates and template parts are warnings because parent
themes or WordPress may provide them. Style variations are validated without
requiring their own `version` field. This does not run visual browser checks.

Errors fail one-shot builds; warnings do not. Watch mode stays running after
validation errors and rechecks theme.json, style variations, and source block.json
files on changes. Startup checks all metadata; subsequent saves check only the
changed file. Changes are debounced per file, so saving several files together
does not drop any checks. Creating, changing, or deleting a referenced local
asset revalidates only its owning metadata files. Pausing still removes deleted
blocks from the index; metadata and asset edits made while paused are checked
on resume. Filesystem inspection failures are reported against the affected
metadata without preventing checks of other files. Version detection or schema
loading failures report that validation could not start, rather than zero failed
files. Schema failures wait for both requests and cache writes to settle before
returning, so shutdown and cache clearing cannot race a remaining download.
Initial validation runs after the "Started initial
build" message. The detected WordPress version appears as `WP vx.x.x` beside
the tool version in the watch header, not as a separate log message. The version
and schemas are reused for the watch session; restart watching after a WordPress
upgrade. Duplicate block names are checked against an in-memory index updated
as block metadata changes or is removed. Terminal logs wrap long messages,
including paths and JSON property pointers, and scrolling counts wrapped rows.
Validation results are cached in memory for the watch session using content
hashes. Unchanged saves reuse diagnostics, including warnings and errors, while
referenced-file presence is rechecked and duplicate names use the current index.
Changed contents, schemas, or the detected WordPress version invalidate results.
Restarting watch discards this result cache; it is not persisted to disk.
Logs use the same `(cached)` and `in Nms` indicators as other builds, including
cache-check time. Initial validation reports total elapsed time, including
version detection and any schema loading.
Validation itself does not format or modify source files;
only its schema cache is written. The optional version command does not disable
validation or allow a different schema target to be selected directly.

## Watch

PHP saves automatically fix formatting without logging coding-standard
violations. PHP syntax errors are still logged and prevent formatting and reload.

While watch is enabled, use the following keyboard commands to control the build process:

```sh
[r]     Restart build process
[c]     Clear cache and restart
[p]     Pause/Resume watching
[n]     New component
[i]     Show build information (components, URLs, and commands)
[f]     Toggle filter
[/]     Search logs
[q]     Quit
````

`SIGINT`, `SIGTERM` and `SIGHUP` (for example a closed terminal, `kill`, or a process
supervisor) all stop watchers, flush the cache manifest and restore the terminal
before exiting. `SIGTERM` and `SIGHUP` exit with the conventional status `143` and
`129`; a second signal exits immediately, and a shutdown that hangs is cut off after
five seconds.

## AI Agents

This package ships an [Agent Skill](https://agentskills.io) at
`.agents/skills/sdc-build-wp/SKILL.md` with WordPress theme/plugin development
standards and conventions for AI coding agents working in projects built with
sdc-build-wp. Because agents don't discover skills inside `node_modules`, run
the installer from your project root:

```sh
sdc-build-wp agents            # interactive prompt
sdc-build-wp agents reference  # add a pointer to the packaged skill in AGENTS.md
sdc-build-wp agents copy       # copy the skill into .agents/skills/
```

`reference` (recommended) appends a short section to your project's
`AGENTS.md` (creating it if needed) directing agents to the skill inside
`node_modules`. The pointer sits in always-loaded agent context, keeps your
`AGENTS.md` minimal, and guidance stays current with the installed version.
`copy` places a standalone copy in `.agents/skills/sdc-build-wp/` where agents
discover it as an on-demand skill; re-run it after upgrading to refresh the
copy. The reference is only added once; both commands are safe to re-run.

## Develop

Run `sdc-build-wp --doctor` (or `sdc-build-wp doctor`) to diagnose configuration,
Node/PHP availability, PHP formatting tools, source and entry paths, output
permissions, proxy connectivity, port availability, and configured TLS files.
Use `--builds=style,scripts` to limit component-specific checks. Diagnostics do
not build assets, migrate legacy settings, or create cache files. Errors exit
with status `1`; optional missing source directories produce warnings.

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
Block orchestration unit tests stub webpack execution; CLI integration also
compiles a real block and verifies its metadata and dependency output.
Cache lifecycle, Sass dependency updates, and watcher event routing also have
regression coverage. Watcher unit tests simulate events without starting servers.

Run the fixture's build and PHP integration tests with `npm run test:theme`.
The tests create temporary WordPress version metadata and offline schema caches;
no installed WordPress site or network access is required. Direct fixture
commands (`npm run build:theme` and `npm run build:theme:watch`) require this
checkout to be within a detectable WordPress installation. The direct build writes ignored
output and cache files inside the fixture and processes styles, scripts, and
images; PHP linting is exercised by `test:theme`. Pass extra build options with
`npm run build:theme -- --no-cache`.
Use `npm run build:theme:watch` to watch the fixture and rebuild styles, scripts,
and images on changes without starting BrowserSync. Quit with `q` or Ctrl+C.

`npm test` includes a real CLI build of the theme in `tests/fixtures/theme`.
Tests build a temporary copy, verify Sass, JavaScript, SVG output and source maps,
and check cache reuse, dependency changes, missing outputs, and `--no-cache`.
The fixture stays unchanged. A block render PHP fixture also tests discovery,
quiet formatting, acceptance of coding-standard violations, and rejection of syntax errors through
the PHP component. Run `composer install` and have PHP available before running
the full suite; release CI installs these tools automatically. No WordPress
server is required. Server-free file watching, recovery from broken imports,
failure exit codes, invalid configuration, and failed output writes are tested.
Interactive terminal rendering is not covered by the fixture tests.

Use `npm run release:patch`, `npm run release:minor`, or `npm run release:major`.
All tests must pass before the release script changes the version, commits, tags,
or pushes. Tagged CI releases also require the full test suite to pass before
creating the GitHub release or publishing to npm.
