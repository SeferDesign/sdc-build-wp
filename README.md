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

```sh
sdc-build-wp --no-cache        # Disable caching for this build
sdc-build-wp --clear-cache     # Clear all cached data
```

## Configuration

Optional concurrency caps can be set in `.sdc-build-wp/config.json` to keep expensive builds parallel without oversubscribing the machine.

```json
{
	"buildConcurrency": {
		"default": 10,
		"style": 10,
		"scripts": 10,
		"blocks": 10,
		"images": 10
	}
}
```

## Watch

While watch is enabled, use the following keyboard commands to control the build process:

```sh
[r]     Restart build process
[c]     Clear cache
[p]     Pause/Resume watching
[n]     New component
[q]     Quit
````

## Develop

Develop locally with the following command from within the test project directory:

```
node ~/sites/sdc/sdc-build-wp/index.js --watch
# or
sdc-build-wp-local --watch
```
