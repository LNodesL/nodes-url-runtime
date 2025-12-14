import https from 'https';
import http from 'http';
import { execSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create a runtime directory for installed packages
const RUNTIME_DIR = join(tmpdir(), 'import-runtime');
const PACKAGE_DIR = join(RUNTIME_DIR, 'packages');

// Ensure directories exist
if (!existsSync(PACKAGE_DIR)) {
  mkdirSync(PACKAGE_DIR, { recursive: true });
}

// Ensure package.json exists in runtime directory for npm install
const runtimePackageJson = join(PACKAGE_DIR, 'package.json');
if (!existsSync(runtimePackageJson)) {
  writeFileSync(runtimePackageJson, JSON.stringify({
    name: 'import-runtime-packages',
    version: '1.0.0',
    description: 'Runtime-installed packages',
    private: true
  }, null, 2));
}

// Track installed packages to avoid re-installing
const installedPackages = new Set();

/**
 * Downloads content from a URL
 */
function download(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    protocol.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download: ${res.statusCode}`));
        return;
      }
      
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        resolve(data);
      });
    }).on('error', reject);
  });
}

/**
 * Installs a package dynamically using npm
 */
function installPackage(packageName) {
  if (installedPackages.has(packageName)) {
    return;
  }
  
  console.log(`Installing ${packageName}...`);
  
  try {
    // Install package to the runtime directory
    // Use --prefix to install in the runtime directory
    execSync(`npm install ${packageName} --prefix ${PACKAGE_DIR} --no-save --silent --no-package-lock`, {
      stdio: 'inherit',
      cwd: PACKAGE_DIR,
      env: { ...process.env, NODE_ENV: 'production' }
    });
    
    installedPackages.add(packageName);
    console.log(`✓ Installed ${packageName}`);
  } catch (error) {
    console.error(`Failed to install ${packageName}:`, error.message);
    throw error;
  }
}

/**
 * Extracts require/import statements from code to find dependencies
 */
function extractDependencies(code) {
  const dependencies = new Set();
  
  // Match require() calls - handle both single and double quotes
  const requireRegex = /require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  let match;
  while ((match = requireRegex.exec(code)) !== null) {
    const dep = match[1];
    // Skip built-in modules and relative paths
    if (!dep.startsWith('.') && !dep.startsWith('/') && !dep.startsWith('node:')) {
      // Handle scoped packages (@scope/package) and regular packages
      const parts = dep.split('/');
      if (dep.startsWith('@')) {
        // Scoped package: @scope/package
        dependencies.add(parts.slice(0, 2).join('/'));
      } else {
        // Regular package
        dependencies.add(parts[0]);
      }
    }
  }
  
  // Match ES6 import statements - various formats
  const importRegex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+))*\s+from\s+)?['"`]([^'"`]+)['"`]/g;
  while ((match = importRegex.exec(code)) !== null) {
    const dep = match[1];
    if (!dep.startsWith('.') && !dep.startsWith('/') && !dep.startsWith('node:')) {
      const parts = dep.split('/');
      if (dep.startsWith('@')) {
        dependencies.add(parts.slice(0, 2).join('/'));
      } else {
        dependencies.add(parts[0]);
      }
    }
  }
  
  // Match dynamic import()
  const dynamicImportRegex = /import\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  while ((match = dynamicImportRegex.exec(code)) !== null) {
    const dep = match[1];
    if (!dep.startsWith('.') && !dep.startsWith('/') && !dep.startsWith('node:')) {
      const parts = dep.split('/');
      if (dep.startsWith('@')) {
        dependencies.add(parts.slice(0, 2).join('/'));
      } else {
        dependencies.add(parts[0]);
      }
    }
  }
  
  return Array.from(dependencies);
}

/**
 * Installs all dependencies found in the code
 */
function installDependencies(code) {
  const require = createRequire(import.meta.url);
  const deps = extractDependencies(code);
  
  for (const dep of deps) {
    // Skip Node.js built-in modules
    try {
      require.resolve(dep);
      continue;
    } catch (e) {
      // Not a built-in, try to install
    }
    
    // Check if already installed in runtime directory
    const packagePath = join(PACKAGE_DIR, 'node_modules', dep);
    if (!existsSync(packagePath)) {
      installPackage(dep);
    }
  }
}

/**
 * Executes the downloaded script with proper module resolution
 */
function executeScript(code, scriptUrl) {
  const require = createRequire(import.meta.url);
  const Module = require('module');
  
  // Install dependencies first
  installDependencies(code);
  
  // Add runtime node_modules to require path
  const runtimeNodeModules = join(PACKAGE_DIR, 'node_modules');
  const originalResolveFilename = Module._resolveFilename;
  
  // Intercept module resolution to handle runtime-installed packages
  Module._resolveFilename = function(request, parent, isMain, options) {
    try {
      // Try original resolution first (built-ins, local files, etc.)
      return originalResolveFilename.call(this, request, parent, isMain, options);
    } catch (err) {
      // If it fails, try in runtime node_modules
      if (err.code === 'MODULE_NOT_FOUND') {
        try {
          const runtimePath = require.resolve(request, {
            paths: [runtimeNodeModules, ...(options?.paths || [])]
          });
          return runtimePath;
        } catch (runtimeErr) {
          // If still not found, try installing it on-the-fly
          if (!request.startsWith('.') && !request.startsWith('/') && !request.startsWith('node:')) {
            // Extract package name (handle scoped packages)
            const parts = request.split('/');
            const packageName = request.startsWith('@') 
              ? parts.slice(0, 2).join('/')
              : parts[0];
            
            if (!installedPackages.has(packageName)) {
              installPackage(packageName);
              try {
                return require.resolve(request, {
                  paths: [runtimeNodeModules, ...(options?.paths || [])]
                });
              } catch (finalErr) {
                // Re-throw original error if still can't resolve
                throw err;
              }
            }
          }
          throw err;
        }
      }
      throw err;
    }
  };
  
  try {
    // Create a temporary file for the script
    const tempFile = join(RUNTIME_DIR, `script-${Date.now()}.js`);
    writeFileSync(tempFile, code);
    
    // Add runtime node_modules to NODE_PATH for child processes
    const originalNodePath = process.env.NODE_PATH || '';
    process.env.NODE_PATH = [runtimeNodeModules, originalNodePath].filter(Boolean).join(':');
    
    // Execute using require (works for CommonJS)
    require(tempFile);
    
    // Restore NODE_PATH
    process.env.NODE_PATH = originalNodePath;
  } catch (error) {
    // If require fails, try with eval (for ES modules or other cases)
    if (error.code === 'ERR_REQUIRE_ESM') {
      // For ES modules, we'd need a different approach
      // This is a simplified version - full ES module support would require more complexity
      throw new Error('ES modules are not fully supported. Please use CommonJS format.');
    }
    throw error;
  } finally {
    // Restore original resolve function
    Module._resolveFilename = originalResolveFilename;
  }
}

/**
 * Main run function - downloads and executes a script from a URL
 * @param {string} url - URL of the script to download and execute
 */
export async function run(url) {
  if (!url) {
    throw new Error('URL is required');
  }
  
  try {
    console.log(`Downloading script from ${url}...`);
    const code = await download(url);
    console.log('✓ Script downloaded');
    
    console.log('Executing script...');
    executeScript(code, url);
    console.log('✓ Script executed successfully');
  } catch (error) {
    console.error('Error:', error.message);
    throw error;
  }
}

// Default export
export default { run };

