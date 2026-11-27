# WordPress validation

Source theme and block validation runs automatically before every build and when source metadata changes in watch mode. By default it has no standalone command, version/path override, compiled-output mode, or refresh flag.

Validation itself does not format or modify source files; only its schema cache is written. This does not run visual browser checks.

## What is checked

Checks cover schema errors with JSON property paths, local fonts and images, Sass token collisions and invalid variable names, duplicate block names, and missing block render files.

- Source-only CSS and JavaScript references may point at future compiled files; missing files for these deferred references are not warnings. Missing required render, variation, font, and image files remain errors.
- Generated block build directories are excluded; only source metadata is checked.
- Missing declared templates and template parts are warnings because parent themes or WordPress may provide them.
- Style variations are validated without requiring their own `version` field.

Errors fail one-shot builds; warnings do not.

## Relaxing validation (CI and offline machines)

Validation can be relaxed without hiding it from normal local builds:

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

- `validation.enabled: false` skips validation entirely, like the flag.
- `validation.failOn: "never"` still runs it but reports every problem (including schema download failures) as warnings so the build continues and exits normally.

The default is `{ "enabled": true, "failOn": "error" }`. The optional version command does not disable validation or allow a different schema target to be selected directly.

## Detecting the WordPress version

Validation reads the nearest ancestor `wp-includes/version.php` without running PHP or bootstrapping WordPress. Symlinked themes also search their real path. When local version metadata is missing or inaccessible, detection falls back to `wordpressVersionCommand` if configured, otherwise the WordPress generator meta tag served by `browsersync.localProxyURL`. Site upgrades automatically select schemas for the detected version.

Precedence: a readable local version file always wins, then a configured command, then HTTP metadata.

### Proxy detection

Proxy detection has a five-second timeout and requires an exposed WordPress generator meta tag; hardened sites often remove it, and page caches can serve a stale value. Asset query strings and public REST responses are not reliable core version sources. HTTPS proxy detection verifies TLS; use a command when local certificates cannot be trusted by Node.

### `wordpressVersionCommand`

Use a command for containerized or restricted installations:

```json
{
	"wordpressVersionCommand": "docker compose exec -T wordpress wp core version --path=/var/www/html --allow-root",
	"browsersync": {
		"localProxyURL": "https://example.loc"
	}
}
```

Adjust the service name, WordPress path, and WP-CLI options for the instance. The command runs through the system shell in the project directory with its existing environment. It must print only the version (for example `6.8.3`) on stdout; diagnostics can go to stderr. It has a ten-second timeout and a 64 KiB output limit. A configured command that fails or prints invalid output is an error, not a reason to silently fall back to HTTP. Only use trusted project configuration: this setting executes code.

## Schemas

Official theme and block schemas are downloaded from `https://schemas.wp.org/wp/<major.minor>/` on first use. Patch releases share their release's schema, for example WordPress 6.8.3 uses 6.8. Prereleases use their major/minor URL, which must exist on the schema service. No WordPress schemas are bundled.

- Schemas are cached per project in `.sdc-build-wp/cache/schemas/` and reused offline. This location is fixed and covered by the existing cache ignore rule.
- Downloads time out after ten seconds, are checked before caching, and are written atomically. Corrupt cached schemas are downloaded again.
- Missing schemas or failed initial downloads are errors (unless `failOn` is `"never"`); validation never silently substitutes another version.
- `--clear-cache` removes schemas along with build cache data; the next build needs internet access to download them again. The watch-mode `c` command stops watchers and pending validation before clearing the cache, then downloads schemas during the restarted build.
- `--no-cache` disables compilation and validation-result caching but still reuses downloaded schemas for mandatory validation.
- Schema failures wait for both requests and cache writes to settle before returning, so shutdown and cache clearing cannot race a remaining download.

## Watch mode

Watch mode stays running after validation errors and rechecks `theme.json`, style variations, and source `block.json` files on changes.

- Startup checks all metadata; subsequent saves check only the changed file.
- Changes are debounced per file, so saving several files together does not drop any checks.
- Creating, changing, or deleting a referenced local asset revalidates only its owning metadata files.
- Pausing still removes deleted blocks from the index; metadata and asset edits made while paused are checked on resume.
- Filesystem inspection failures are reported against the affected metadata without preventing checks of other files.
- Version detection or schema loading failures report that validation could not start, rather than zero failed files.
- The detected WordPress version appears as `WP vx.x.x` beside the tool version in the watch header, not as a separate log message. The version and schemas are reused for the watch session; restart watching after a WordPress upgrade.
- Duplicate block names are checked against an in-memory index updated as block metadata changes or is removed.

### Result caching

Validation results are cached in memory for the watch session using content hashes. Unchanged saves reuse diagnostics, including warnings and errors, while referenced-file presence is rechecked and duplicate names use the current index. Changed contents, schemas, or the detected WordPress version invalidate results. Restarting watch discards this result cache; it is not persisted to disk.

## Output

Initial validation runs after the "Started initial build" message and reports total elapsed time, including version detection and any schema loading. Logs use the same `(cached)` and `in Nms` indicators as other builds, including cache-check time. Terminal logs wrap long messages, including paths and JSON property pointers, and scrolling counts wrapped rows.
