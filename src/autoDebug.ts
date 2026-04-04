import React from 'react';
import RootSiblingsManager from 'react-native-root-siblings';
import { GeoDebugOverlay } from './GeoDebugOverlay';

let sibling: InstanceType<typeof RootSiblingsManager> | null = null;

export function mountDebugOverlay(): void {
  if (!sibling) {
    sibling = new RootSiblingsManager(React.createElement(GeoDebugOverlay));
  }
}

export function unmountDebugOverlay(): void {
  if (sibling) {
    sibling.destroy();
    sibling = null;
  }
}
