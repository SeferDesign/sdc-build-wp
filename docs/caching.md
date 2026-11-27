# Caching

Caching speeds up subsequent builds by only rebuilding files that have changed or whose dependencies have changed.

```sh
sdc-build-wp --no-cache        # Disable caching for this build
sdc-build-wp --clear-cache     # Clear all cached data
```

The cache lives in `.sdc-build-wp/cache/`, which sdc-build-wp adds to your `.gitignore`.

## Dependency tracking

- **Sass** tracking follows nested `@use`, `@forward` and `@import` statements, including comma lists, partials and `index` files.
- **Scripts** tracking follows static, side-effect and re-export imports, dynamic `import()` and `require()`.
- **Images** are cached too.
- **Compiler-reported files:** the import scanner only predicts dependencies, so each successful build also records the files the compiler reports it actually loaded (Sass `loadedUrls`, esbuild's metafile). This covers `meta.load-css()`, bundled `node_modules` packages and aliased paths, and those files feed watch-mode rebuilds as well as cache checks.
- **Blocks** record the project files webpack actually read (see [Blocks](blocks.md)).

Script dependency graphs are refreshed after lint fixes, once per processed entry, and reused for cache checks. Watch rebuilds refresh only affected entries when the changed file is already in the graph.

## Environments

The manifest is tied to the build environment, so switching between development and `NODE_ENV=production` (or `--production`, see [CI builds](ci.md)) discards cached entries instead of reusing the other mode's output.

## Performance

- Cache manifest updates are batched during the initial build and coalesced over 100ms in watch mode. Writes are serialized and atomic, and pending updates are flushed before restarting or exiting.
- Dependency hashes are read concurrently, with duplicate in-flight reads shared across entries. `buildConcurrency.cache` controls the number of concurrent dependency checks per entry (default: 8). These lightweight reads do not consume compilation slots. See [Configuration](configuration.md#build-concurrency).
- Downloaded WordPress schemas are stored in the same directory; see [Validation](validation.md#schemas).
