import React, { useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';

interface TauriEnvironmentBannerProps {
  isBluetoothSupported: boolean;
}

export const TauriEnvironmentBanner: React.FC<TauriEnvironmentBannerProps> = ({
  isBluetoothSupported,
}) => {
  const [copied, setCopied] = useState(false);
  const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
  const currentUrl = typeof window !== 'undefined' ? window.location.href : 'http://localhost:1420';

  const handleOpenInChrome = async () => {
    try {
      if (isTauri) {
        await openUrl(currentUrl);
      } else {
        window.open(currentUrl, '_blank');
      }
    } catch (e) {
      console.warn('Could not launch browser automatically:', e);
      handleCopy();
    }
  };

  const handleCopy = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(currentUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  if (isBluetoothSupported && !isTauri) {
    return (
      <div className="env-banner success">
        <div className="env-banner-content">
          <span className="env-badge chrome">Chrome / Web Bluetooth Ready</span>
          <span className="env-text">
            Web Bluetooth is enabled. You can pair and connect directly to your Aidmed One device.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="env-banner warning">
      <div className="env-banner-icon">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <div className="env-banner-content">
        <div className="env-header-row">
          <strong>
            {isTauri
              ? 'Tauri V2 Desktop Environment Detected'
              : 'Web Bluetooth Not Detected in this Browser'}
          </strong>
        </div>
        <p className="env-description">
          The Web Bluetooth API (<code>navigator.bluetooth</code>) is supported in{' '}
          <strong>Google Chrome</strong> and Chromium browsers. On macOS/desktop, webviews (WebKit) do not provide
          direct Bluetooth access. To connect via Bluetooth, open this page in Chrome or use the Demo Simulator below.
        </p>
        <div className="env-actions">
          <button type="button" className="btn-primary-small" onClick={handleOpenInChrome}>
            Open in Google Chrome ({currentUrl})
          </button>
          <button type="button" className="btn-secondary-small" onClick={handleCopy}>
            {copied ? '✓ URL Copied!' : 'Copy Localhost URL'}
          </button>
        </div>
      </div>
    </div>
  );
};
