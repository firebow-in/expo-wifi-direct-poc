const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const localModulePath = path.resolve(projectRoot, 'modules', 'expo-wifi-direct');

const config = getDefaultConfig(projectRoot);

// Resolve expo-wifi-direct to the local module (avoids symlink issues on Windows)
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  'expo-wifi-direct': localModulePath,
};
config.watchFolders = [...(config.watchFolders || []), localModulePath];

module.exports = config;
