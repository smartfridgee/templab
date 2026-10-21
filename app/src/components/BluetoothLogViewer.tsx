import React, { useState } from 'react';
import { LogEntry } from '../types/bluetooth';

interface BluetoothLogViewerProps {
  logs: LogEntry[];
  onClear: () => void;
}

export const BluetoothLogViewer: React.FC<BluetoothLogViewerProps> = ({ logs, onClear }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="log-viewer-container">
      <div className="log-viewer-header" onClick={() => setIsOpen(!isOpen)}>
        <div className="log-viewer-title">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
          <span>Bluetooth Activity & GATT Logs</span>
          <span className="log-count">({logs.length})</span>
        </div>
        <div className="log-actions" onClick={(e) => e.stopPropagation()}>
          {logs.length > 0 && (
            <button type="button" className="btn-text" onClick={onClear}>
              Clear Logs
            </button>
          )}
          <button type="button" className="btn-toggle" onClick={() => setIsOpen(!isOpen)}>
            {isOpen ? '▲ Collapse' : '▼ Expand'}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="log-viewer-body">
          {logs.length === 0 ? (
            <div className="log-empty">No activity logs recorded yet.</div>
          ) : (
            <div className="log-list">
              {logs.map((log) => (
                <div key={log.id} className={`log-row log-${log.type}`}>
                  <span className="log-time">[{log.timestamp}]</span>
                  <span className={`log-badge badge-${log.type}`}>{log.type.toUpperCase()}</span>
                  <span className="log-msg">{log.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
