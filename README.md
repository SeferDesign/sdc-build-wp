## Install

```sh
npm install sdc-build-wp
sdc-build-wp # build
sdc-build-wp --watch # build and watch
sdc-build-wp --watch --builds=style,scripts # comma-seperated list of components to include
sdc-build-wp --help
```

## Caching

sdc-build-wp includes intelligent build caching to speed up subsequent builds by only rebuilding files that have changed or whose dependencies have changed.

```sh
sdc-build-wp --no-cache        # Disable caching for this build
sdc-build-wp --clear-cache     # Clear all cached data
```

## Watch

While watch is enabled, use the following keyboard commands to control the build process:

```sh
[r]     Restart
[p]     Pause/Resume
[q]     Quit
````

## Develop

Develop locally with the following command from within the test project directory:

```
node ~/sites/sdc/sdc-build-wp/index.js --watch
```
