/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { deviceLinkTask } from './src/integrations/devices/headless';

AppRegistry.registerComponent(appName, () => App);
// Run by DeviceLinkService: keeps Bluetooth links alive with the app closed (see docs/DEVICES.md).
AppRegistry.registerHeadlessTask('DeviceLink', () => deviceLinkTask);
