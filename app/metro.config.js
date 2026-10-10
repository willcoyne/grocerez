// Metro config: lets the app import the backend's zod contracts through `@contracts/*`
// (server/src/contracts), so request/response types and enums are shared, not copied.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const contractsRoot = path.resolve(projectRoot, "../server/src/contracts");

const config = getDefaultConfig(projectRoot);

// Watch the contracts folder (outside the app root).
config.watchFolders = [...(config.watchFolders ?? []), contractsRoot];

// Contracts import `zod`; resolve it from the app's node_modules (the server's may not be installed).
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];

const upstreamResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstreamResolve ?? context.resolveRequest;
  if (moduleName.startsWith("@contracts/")) {
    const file = path.join(contractsRoot, moduleName.slice("@contracts/".length));
    return resolve(context, file, platform);
  }
  // The server is ESM/NodeNext, so contracts import siblings as "./common.js" while the file is common.ts.
  if (context.originModulePath.startsWith(contractsRoot) && moduleName.startsWith(".") && moduleName.endsWith(".js")) {
    return resolve(context, moduleName.slice(0, -3), platform);
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
