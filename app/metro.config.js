const fs = require('fs');
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// @contracts/* resolves to ../server/src/contracts (shared zod schemas). Metro only bundles files
// inside watchFolders, so add the server folder once it exists.
const serverDir = path.resolve(__dirname, '../server');
if (fs.existsSync(serverDir)) {
  config.watchFolders = [...(config.watchFolders ?? []), serverDir];
}

module.exports = config;
