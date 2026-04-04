import React, { useState, useEffect } from 'react';
import RNGeoService from './index';
import { _isDebugMode } from './index';
import { GeoDebugPanel } from './GeoDebugPanel';

/**
 * Drop this anywhere in your component tree once.
 * It renders the GeoDebugPanel automatically when:
 *   - debug: true was passed to configure()
 *   - location tracking is active (implies permission was granted)
 * Nothing is rendered if debug is false or tracking hasn't started.
 */
export const GeoDebugOverlay: React.FC = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const tracking = await RNGeoService.isTracking();
        if (!cancelled) setVisible(_isDebugMode() && tracking);
      } catch (_) {
        if (!cancelled) setVisible(false);
      }
    };

    check();
    const id = setInterval(check, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!visible) return null;
  return <GeoDebugPanel />;
};
