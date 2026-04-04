/**
 * Import this file ONCE at the top of your app's index.js, before
 * AppRegistry.registerComponent. This registers RootSiblingParent as
 * the app wrapper so GeoService can render the debug overlay automatically
 * when configure({ debug: true }) is called — no component needed in the tree.
 *
 * index.js:
 *   import '@tsachit/react-native-geo-service/setup';  // ← add this line
 *   import { AppRegistry } from 'react-native';
 *   import App from './App';
 *   AppRegistry.registerComponent('MyApp', () => App);
 */
import { AppRegistry } from 'react-native';
import { RootSiblingParent } from 'react-native-root-siblings';

AppRegistry.setWrapperComponentProvider(() => RootSiblingParent as any);
