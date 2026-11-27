# Production and CI builds

```sh
sdc-build-wp --production         # NODE_ENV=production: no source maps, production block builds
sdc-build-wp --ci                 # --production plus strict checks for pipelines
sdc-build-wp --ci --json          # machine-readable result on stdout
```

## `--production`

Sets `NODE_ENV=production` for the whole run, so output never reuses cached development files (the cache is keyed by environment, see [Caching](caching.md)) and no source maps are written.

## `--ci`

Implies `--production` and makes the run safe for pipelines:

- Style and script lint only check, never rewriting sources.
- Lint issues that would have been auto-fixed, and any other warning, exit with status `1`. An undetectable WordPress version is one such warning; resolve it with `--skip-validation` or `wordpressVersionCommand` (see [Validation](validation.md)).
- Unfixable Stylelint errors fail every one-shot build, matching script lint errors.

`--ci` and `--json` run a single build and cannot be combined with `--watch`.

## `--json`

Keeps stdout for one JSON document and writes all log output to stderr:

```json
{ "success": true, "version": "5.13.0", "durationMs": 1840, "components": ["cache", "style", "scripts"], "errors": [], "warnings": [] }
```

`errors` and `warnings` list `{ "component", "message" }` objects without terminal colors. A summary is also printed when validation aborts the build.

## Exit codes

One-shot builds exit with status `1` when a component reports an error, including script lint errors remaining after automatic fixes. Watch mode reports errors without exiting so subsequent saves can recover.

## Typical pipeline

```sh
sdc-build-wp --ci --skip-validation
```

The repository's own CI workflow (`.github/workflows/ci.yml`) runs the test suite on pushes to `master` and on pull requests.
