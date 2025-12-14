# nodes-url-runtime

A Node.js package that downloads and executes scripts from URLs with automatic dependency installation at runtime.

Official Package: https://www.npmjs.com/package/nodes-url-runtime


## Features

- 📥 Downloads scripts from any HTTP/HTTPS URL
- 🔍 Automatically detects dependencies from `require()` and `import` statements
- 📦 Dynamically installs missing npm packages at runtime
- 🚀 No rebuild or pre-installation required
- ✨ Simple API - just call `run(url)`

## Installation

```bash
npm install nodes-url-runtime
```

## Usage

```javascript
import { run } from 'nodes-url-runtime';

// Download and execute a script from a URL
await run('https://example.com/script.js');
```

The package will:
1. Download the script from the URL
2. Analyze it to find all dependencies
3. Automatically install any missing npm packages
4. Execute the script with all dependencies available

## Example

```javascript
import { run } from 'nodes-url-runtime';

// This script can use any npm package - it will be installed automatically!
await run('https://raw.githubusercontent.com/user/repo/main/script.js');
```

If the script at that URL contains:
```javascript
const axios = require('axios');
const lodash = require('lodash');

console.log('Script running with dependencies!');
```

The package will automatically install `axios` and `lodash` before executing the script.

## How It Works

1. **Download**: Fetches the script content from the provided URL
2. **Dependency Detection**: Parses the code to find all `require()` and `import` statements
3. **Dynamic Installation**: Installs missing packages to a temporary runtime directory
4. **Module Resolution**: Intercepts Node.js module resolution to use runtime-installed packages
5. **Execution**: Runs the script with all dependencies available

## Supported Formats

- ✅ CommonJS (`require()`)
- ✅ ES6 imports (`import ... from`)
- ✅ Dynamic imports (`import()`)
- ✅ Scoped packages (`@scope/package`)

## Limitations

- ES modules (`.mjs` files) are not fully supported - scripts should use CommonJS format
- The package installs dependencies to a temporary directory (system temp folder)
- First execution may be slower due to dependency installation

## License

MIT

