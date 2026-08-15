const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Metro will not bundle an extension it does not know about, so without this
// line assets/crop_model.tflite is silently absent from the APK and the app
// falls back to the stub classifier forever. react-native-fast-tflite requires
// the model to be a bundled asset.
config.resolver.assetExts.push('tflite');

module.exports = config;
