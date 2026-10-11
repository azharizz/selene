// https://docs.expo.dev/guides/using-eslint/
const {defineConfig} = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([expoConfig, {ignores: ['dist/*', 'android/*']},
  // Animated.Value held in useRef and interpolated in render is the standard React Native animation pattern.
  {rules: {'react-hooks/refs': 'off'}}]);
