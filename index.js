import {AppRegistry, LogBox} from 'react-native';
import {name as appName} from './app.json';
// SDK warnings can precede the entry point and become this generic notice.
// Hide the notice in the TV UI; console warnings and error overlays remain.
LogBox.ignoreLogs(['useComponentInstance is deprecated. Update to use getComponentInstance from KeplerAppStateManager instead.', 'Open debugger to view warnings.', 'Running debug build of JavaScript',
  // Raised inside @amazon-devices/react-native-w3cmedia's own components, not app code.
  'forwardRef render functions accept exactly two parameters',
  // A full SourceBuffer is expected while streaming; src/media.ts waits and retries.
  'appendBuffer error']);
AppRegistry.registerComponent(appName, () => require('./src/App').App);
