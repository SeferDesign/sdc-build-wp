# Project setup and diagnostics

## `init`

```sh
sdc-build-wp init            # scaffold a new project
sdc-build-wp init --force    # also replace an existing configuration
```

Writes `.sdc-build-wp/config.json` with a `$schema` reference for editor autocomplete, and creates `_src/style`, `_src/scripts`, `_src/images` and `_src/fonts`, adding a starter `main.scss` and `main.js` only to directories that are new or empty. Existing files are never touched; the configuration is only replaced with `--force`. When `package.json` still has legacy `sdc` settings, `init` leaves them for the next build to migrate.

## `doctor`

```sh
sdc-build-wp doctor                       # or: sdc-build-wp --doctor
sdc-build-wp doctor --builds=style,scripts
sdc-build-wp doctor --fix
```

Diagnoses configuration, Node/PHP availability, PHP formatting tools, source and entry paths, output permissions, proxy connectivity, port availability, and configured TLS files.

Use `--builds=style,scripts` to limit component-specific checks. Diagnostics do not build assets, migrate legacy settings, or create cache files. Errors exit with status `1`; optional missing source directories produce warnings.

### `--fix`

Repairs what has a safe remedy: it creates a missing `.sdc-build-wp/config.json` and missing source directories, and reports each repair as `Fixed: ...`. It never rewrites an existing or invalid configuration, touches legacy `package.json` settings, or installs tools.

## Other commands

- `sdc-build-wp agents`: install AI agent guidance (see [AI agents](agents.md)).
- `sdc-build-wp --help`: all options, components and watch-mode controls.
- `sdc-build-wp --version`: print the version. `--help` and `--version` work outside a project directory.
