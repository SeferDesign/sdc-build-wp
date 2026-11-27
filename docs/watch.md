# Watch mode

```sh
sdc-build-wp --watch                        # build and watch
sdc-build-wp --watch --builds=style,scripts # limit the components
```

Watch mode rebuilds on change, reloads the browser through the BrowserSync dev server, and tails the PHP error log.

PHP saves automatically fix formatting without logging coding-standard violations. PHP syntax errors are still logged and prevent formatting and reload.

## Keyboard commands

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
```

`n` scaffolds a **Block**, **Pattern** or **Style variation** from a template; names must contain letters or numbers and cannot collide with an existing file.

## Signals

`SIGINT`, `SIGTERM` and `SIGHUP` (for example a closed terminal, `kill`, or a process supervisor) all stop watchers, flush the cache manifest and restore the terminal before exiting. `SIGTERM` and `SIGHUP` exit with the conventional status `143` and `129`; a second signal exits immediately, and a shutdown that hangs is cut off after five seconds.

## Configuration changes

Saving `.sdc-build-wp/config.json` reloads the configuration and restarts the build; an invalid edit is reported and the previous configuration stays in effect. See [Configuration](configuration.md).

## Adding a command

Whenever a new watch command is added, document it here, in `lib/help.js`, and in the log that outputs the available commands.
