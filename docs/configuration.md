# Configuration

Settings live in `.sdc-build-wp/config.json`. `sdc-build-wp init` creates the file (see [Project setup](project-setup.md)); without it, defaults are used.

Add `"$schema": "../node_modules/sdc-build-wp/config.schema.json"` to the file for editor autocomplete and validation. The same schema validates configuration at startup. Unknown settings, malformed entry arrays, invalid proxy URLs, and non-positive or fractional concurrency caps are rejected. Unknown `--builds` component names are also rejected before building.

In watch mode, saving `config.json` reloads it and restarts the build. An invalid edit is reported and the previous configuration stays in effect.

## Settings

| Setting | Purpose |
| --- | --- |
| `entries` | Explicit style/script entry points, e.g. `{ "style/main": ["/_src/style/main.scss"] }`. Without it, files directly inside the style and scripts source folders are used. |
| `paths.dist`, `paths.src.*` | Output folder (default `dist`) and source folders (`_src`, `style`, `scripts`, `images`, `fonts`). |
| `styleGlobPath`, `sassGlobPath`, `scriptsGlobPath`, `phpGlobPath`, `htmlGlobPath` | Override which files each component lints, formats or watches. |
| `imagesPath`, `fontsPath` | Image and font source directories outside the default location. |
| `formatOnly` | `{ "style": true, "scripts": true }` formats and lints those files without building them. |
| `php.enabled` | Whether the PHP component formats PHP (default `true`). When `false`, the dev server reloads on PHP changes instead. |
| `errorLogPath` | PHP error log to tail in watch mode. |
| `port`, `browsersync` | Dev server port and BrowserSync options: `localProxyURL`, `watchEvents`, `open`, `tunnel`, `location`. |
| `wordpressVersionCommand`, `validation` | WordPress detection and validation behavior; see [Validation](validation.md). |
| `blocks.timeout` | Per-block compile limit in seconds; see [Blocks](blocks.md). |
| `buildConcurrency` | Parallelism caps; see below. |

The schema in `config.schema.json` is the authoritative reference.

## Build concurrency

Optional concurrency caps keep expensive builds parallel without oversubscribing the machine. By default, concurrency is based on available CPU cores (with a minimum, even on single-core machines, since builds spend meaningful time on process startup/IO rather than pure CPU work).

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

## Legacy settings

Older projects kept these settings under an `sdc` key in `package.json`. The next build migrates them into `.sdc-build-wp/config.json` and removes the key.
