import React from 'react';

interface RecordingControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onPlay: () => void;
  onPause: () => void;
  onLoop: () => void;
  onReset: () => void;
  isPlaying: boolean;
  isLooping: boolean;
  zoom: number;
}

export const RecordingControls: React.FC<RecordingControlsProps> = ({
  onZoomIn,
  onZoomOut,
  onPlay,
  onPause,
  onLoop,
  onReset,
  isPlaying,
  isLooping,
  zoom
}) => {
  return (
    <div className="recording-controls">
      <div className="zoom-controls-wrapper">
        <button className="control-button" onClick={onZoomOut} title="Zoom Out">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="2" fill="none" />
            <line x1="6" y1="10" x2="14" y2="10" stroke="currentColor" strokeWidth="2" />
          </svg>
        </button>

        <button className="control-button" onClick={onZoomIn} title="Zoom In">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="2" fill="none" />
            <line x1="10" y1="6" x2="10" y2="14" stroke="currentColor" strokeWidth="2" />
            <line x1="6" y1="10" x2="14" y2="10" stroke="currentColor" strokeWidth="2" />
          </svg>
        </button>
        <span className="zoom-level">{Math.round(zoom * 100)}%</span>
      </div>

      <button
        className={`control-button play-button ${isPlaying ? 'playing' : ''}`}
        onClick={isPlaying ? onPause : onPlay}
        title={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      <button className="control-button" onClick={onReset} title="Return to Start">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
          {/* Skip to beginning icon: vertical line + double left arrows */}
          <line x1="3" y1="5" x2="3" y2="15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M7 6L4 10L7 14" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M12 6L9 10L12 14" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <button
        className={`control-button ${isLooping ? 'active' : ''}`}
        onClick={onLoop}
        title="Loop"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
          <path d="M10 2C5.58 2 2 5.58 2 10s3.58 8 8 8c1.85 0 3.55-.63 4.9-1.69l-1.42-1.42C12.64 15.56 11.38 16 10 16c-3.31 0-6-2.69-6-6s2.69-6 6-6c3.31 0 6 2.69 6 6h-2l3 4 3-4h-2c0-4.42-3.58-8-8-8z" />
        </svg>
      </button>
    </div>
  );
};

