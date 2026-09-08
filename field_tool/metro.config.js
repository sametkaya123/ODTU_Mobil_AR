// Metro configuration for Expo
// https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// .onnx is a binary model file, not source — treat it as an asset so Metro
// bundles it instead of trying to parse it as JS.
config.resolver.assetExts.push('onnx');

module.exports = config;