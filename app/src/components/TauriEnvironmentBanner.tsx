import React, { useState } from 'react';
import { DEFAULT_BRIDGE_URL } from '../services/bridgeClient';

interface BridgeStatusBannerProps {
  bridgeOnline: boolean;
  isDemoMode: boolean;
}

const START_CMD = 'python3 bridge/aidlab_bridge.py';

export const TauriEnvironmentBanner: React.FC<BridgeStatusBannerProps> = ({
  bridgeOnline,
  isDemoMode,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopyCommand = () => {
    navigator.clipboard?.writeText(START_CMD);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (bridgeOnline) {
    return (
      <div className="env-banner success">
        <div className="env-banner-content">
          <span className="env-badge chrome">Aidlab SDK Bridge Online</span>
          <span className="env-text">
            Connected to official native Aidlab C++ SDK bridge at <code>{DEFAULT_BRIDGE_URL}</code>. Ready to scan and stream 250 Hz ECG.
          </span>
        </div>
      </div>
    );
  }

  if (isDemoMode) {
    return (
      <div className="env-banner success">
        <div className="env-banner-content">
          <span className="env-badge chrome">Demo Simulator Active</span>
          <span className="env-text">
            Streaming synthetic 250 Hz PQRST ECG waveform with realistic baseline wander &amp; 50 Hz mains hum through the live DSP pipeline.
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
          <strong>Aidlab SDK Bridge Not Running ({DEFAULT_BRIDGE_URL})</strong>
        </div>
        <p className="env-description">
          Aidmed One / Aidlab uses a compressed binary framing protocol over BLE decoded by the official{' '}
          <code>aidlabsdk</code> native library. Run the Python bridge in a terminal (works in both Tauri Desktop and browsers), or toggle <strong>Demo Mode</strong> in the top right.
        </p>
        <div className="env-actions">
          <code className="bridge-cmd-code">{START_CMD}</code>
          <button type="button" className="btn-secondary-small" onClick={handleCopyCommand}>
            {copied ? '✓ Command Copied' : 'Copy Bridge Command'}
          </button>
        </div>
      </div>
    </div>
  );
};
