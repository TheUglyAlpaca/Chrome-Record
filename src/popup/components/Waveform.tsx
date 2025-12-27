import React, { useEffect, useRef, useState, useCallback } from 'react';

interface WaveformProps {
  data: Uint8Array | null;
  width?: number;
  height?: number;
  barColor?: string;
  backgroundColor?: string;
  zoom?: number;
  currentTime?: number;
  duration?: number;
  onSeek?: (time: number) => void;
  isRecording?: boolean;
  channelMode?: 'mono' | 'stereo';
  theme?: 'dark' | 'light' | 'midnight' | 'forest' | 'rainbow';
  trimStart?: number;
  trimEnd?: number;
  onTrimChange?: (start: number, end: number) => void;
}

// Theme-specific trim handle colors
const trimHandleColors = {
  dark: { start: '#00d4ff', startText: '#000', end: '#ff6b00', endText: '#fff' },
  light: { start: '#0077b6', startText: '#fff', end: '#d62828', endText: '#fff' },
  midnight: { start: '#a78bfa', startText: '#000', end: '#f472b6', endText: '#000' },
  forest: { start: '#34d399', startText: '#000', end: '#fbbf24', endText: '#000' },
  rainbow: { start: '#c0c0c0', startText: '#000', end: '#c0c0c0', endText: '#000' }
};

export const Waveform: React.FC<WaveformProps> = ({
  data,
  width = 600,
  height = 200,
  barColor = '#ff9500',
  backgroundColor = '#2a2a2a',
  zoom = 1,
  currentTime = 0,
  duration = 0,
  onSeek,
  isRecording = false,
  channelMode,
  theme = 'dark',
  trimStart = 0,
  trimEnd = 0,
  onTrimChange
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastPositionRef = useRef<number>(-1);

  // Scroll offset as a ratio of duration (0 to 1 - 1/zoom)
  const [scrollOffset, setScrollOffset] = useState(0);

  // Drag states
  const [draggingHandle, setDraggingHandle] = useState<'start' | 'end' | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; scrollOffset: number } | null>(null);

  // Clamp scroll offset when zoom changes
  useEffect(() => {
    const maxOffset = Math.max(0, 1 - 1 / zoom);
    if (scrollOffset > maxOffset) {
      setScrollOffset(maxOffset);
    }
  }, [zoom, scrollOffset]);

  // Reset scroll when zoom returns to 1
  useEffect(() => {
    if (zoom === 1) {
      setScrollOffset(0);
    }
  }, [zoom]);

  // Calculate visible time range
  const getVisibleRange = useCallback(() => {
    const visibleDuration = duration / zoom;
    const startTime = scrollOffset * duration;
    const endTime = startTime + visibleDuration;
    return { startTime, endTime, visibleDuration };
  }, [duration, zoom, scrollOffset]);

  // Convert screen X position to time
  const getTimeFromX = useCallback((clientX: number): number => {
    if (!containerRef.current || !duration) return 0;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    const { startTime, visibleDuration } = getVisibleRange();
    return startTime + percentage * visibleDuration;
  }, [duration, getVisibleRange]);

  // Convert time to screen X percentage (relative to container)
  const getXPercentFromTime = useCallback((time: number): number => {
    const { startTime, visibleDuration } = getVisibleRange();
    if (visibleDuration <= 0) return 0;
    return ((time - startTime) / visibleDuration) * 100;
  }, [getVisibleRange]);

  // Draw waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    canvas.width = width;
    canvas.height = height;

    // Clear canvas
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);

    // Calculate which portion of data to show
    const { startTime, endTime } = getVisibleRange();
    const startRatio = duration > 0 ? startTime / duration : 0;
    const endRatio = duration > 0 ? endTime / duration : 1;

    const dataStartIndex = Math.floor(startRatio * data.length);
    const dataEndIndex = Math.ceil(endRatio * data.length);
    const visibleDataLength = dataEndIndex - dataStartIndex;

    if (visibleDataLength <= 0) return;

    // Draw waveform bars for visible portion
    const barCount = Math.min(visibleDataLength, width);
    const barWidth = width / barCount;
    const maxBarHeight = height * 0.8;

    ctx.fillStyle = barColor;

    for (let i = 0; i < barCount; i++) {
      const dataIndex = dataStartIndex + Math.floor((i / barCount) * visibleDataLength);
      const value = data[dataIndex] || 0;
      const barHeight = (value / 255) * maxBarHeight;
      const x = i * barWidth;
      const y = (height - barHeight) / 2;

      ctx.fillRect(x, y, Math.max(1, barWidth - 1), barHeight);
    }
  }, [data, width, height, barColor, backgroundColor, zoom, scrollOffset, duration, getVisibleRange]);

  // Smooth playback position indicator
  useEffect(() => {
    if (duration <= 0 || !data) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let isActive = true;

    const drawPosition = () => {
      if (!isActive || !canvas || !ctx || !data) return;

      const { startTime, endTime, visibleDuration } = getVisibleRange();

      // Calculate which portion of data to show
      const startRatio = startTime / duration;
      const endRatio = endTime / duration;

      const dataStartIndex = Math.floor(startRatio * data.length);
      const dataEndIndex = Math.ceil(endRatio * data.length);
      const visibleDataLength = dataEndIndex - dataStartIndex;

      // 1. Clear canvas
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, width, height);

      // 2. Redraw waveform
      if (visibleDataLength > 0) {
        const barCount = Math.min(visibleDataLength, width);
        const barWidth = width / barCount;
        const maxBarHeight = height * 0.8;

        ctx.fillStyle = barColor;
        for (let i = 0; i < barCount; i++) {
          const dataIndex = dataStartIndex + Math.floor((i / barCount) * visibleDataLength);
          const value = data[dataIndex] || 0;
          const barHeight = (value / 255) * maxBarHeight;
          const x = i * barWidth;
          const y = (height - barHeight) / 2;
          ctx.fillRect(x, y, Math.max(1, barWidth - 1), barHeight);
        }
      }

      // 3. Draw playhead if in visible range
      if (currentTime >= startTime && currentTime <= endTime) {
        const playheadX = ((currentTime - startTime) / visibleDuration) * width;
        ctx.strokeStyle = '#888';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const lineX = Math.floor(playheadX) + 0.5;
        ctx.moveTo(lineX, 0);
        ctx.lineTo(lineX, height);
        ctx.stroke();
        lastPositionRef.current = lineX;
      }

      if (isActive && duration > 0) {
        animationFrameRef.current = requestAnimationFrame(drawPosition);
      }
    };

    animationFrameRef.current = requestAnimationFrame(drawPosition);

    return () => {
      isActive = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [currentTime, duration, width, height, data, zoom, scrollOffset, backgroundColor, barColor, getVisibleRange]);

  // Handle click for seeking
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeek || !duration || isRecording || draggingHandle || isPanning) return;
    const seekTime = getTimeFromX(e.clientX);
    onSeek(Math.max(0, Math.min(seekTime, duration)));
  };

  // Handle mouse down for trim handles
  const handleTrimMouseDown = (e: React.MouseEvent, handle: 'start' | 'end') => {
    e.stopPropagation();
    e.preventDefault();
    setDraggingHandle(handle);
  };

  // Handle mouse down for panning
  const handlePanMouseDown = (e: React.MouseEvent) => {
    if (draggingHandle || zoom <= 1) return;
    // Only start panning on left click and not on handles
    if (e.button !== 0) return;
    setIsPanning(true);
    panStartRef.current = { x: e.clientX, scrollOffset };
  };

  // Handle trim dragging
  useEffect(() => {
    if (!draggingHandle) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!onTrimChange || !duration) return;
      const time = getTimeFromX(e.clientX);
      if (draggingHandle === 'start') {
        const maxStart = trimEnd > 0 ? trimEnd - 0.1 : duration - 0.1;
        onTrimChange(Math.max(0, Math.min(time, maxStart)), trimEnd || duration);
      } else {
        const minEnd = trimStart + 0.1;
        onTrimChange(trimStart, Math.min(duration, Math.max(time, minEnd)));
      }
    };

    const handleMouseUp = () => {
      setDraggingHandle(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingHandle, duration, onTrimChange, trimStart, trimEnd, getTimeFromX]);

  // Handle panning
  useEffect(() => {
    if (!isPanning) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!panStartRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const deltaX = e.clientX - panStartRef.current.x;
      const deltaRatio = deltaX / rect.width / zoom;
      const newOffset = panStartRef.current.scrollOffset - deltaRatio;
      const maxOffset = Math.max(0, 1 - 1 / zoom);
      setScrollOffset(Math.max(0, Math.min(maxOffset, newOffset)));
    };

    const handleMouseUp = () => {
      setIsPanning(false);
      panStartRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isPanning, zoom]);

  // Handle wheel for scrolling
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (zoom <= 1) return;
    e.preventDefault();
    const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
    const scrollAmount = (delta / 500) / zoom;
    const maxOffset = Math.max(0, 1 - 1 / zoom);
    setScrollOffset(prev => Math.max(0, Math.min(maxOffset, prev + scrollAmount)));
  }, [zoom]);

  // Calculate handle positions
  const safeDuration = (duration > 0 && isFinite(duration)) ? duration : 0;

  // During recording, always lock handles at edges (can't trim while recording)
  // After recording, lock at end if trimEnd is 0 or at/beyond duration
  const isAtEnd = isRecording || trimEnd <= 0 || trimEnd >= duration;
  const isAtStart = isRecording || trimStart <= 0;

  const startHandlePercent = isAtStart ? 0 : (safeDuration > 0 ? getXPercentFromTime(trimStart) : 0);
  const endHandlePercent = isAtEnd ? 100 : (safeDuration > 0 ? getXPercentFromTime(trimEnd) : 100);

  // Debug: trace post-recording drift
  console.log('Post-recording debug:', { isRecording, trimEnd, duration, isAtEnd, endHandlePercent });


  // Check if handles are in visible range
  const { startTime: visibleStart, endTime: visibleEnd } = getVisibleRange();
  const isStartHandleVisible = trimStart >= visibleStart && trimStart <= visibleEnd;
  const effectiveTrimEnd = isAtEnd ? duration : trimEnd;
  const isEndHandleVisible = effectiveTrimEnd >= visibleStart && effectiveTrimEnd <= visibleEnd;

  // Calculate dim overlay positions (for visible portion)
  const trimStartPercent = isAtStart ? 0 : (safeDuration > 0 ? Math.max(0, getXPercentFromTime(trimStart)) : 0);
  const trimEndPercent = isAtEnd ? 100 : (safeDuration > 0 ? Math.min(100, getXPercentFromTime(trimEnd)) : 100);

  return (
    <div
      ref={containerRef}
      onClick={handleClick}
      onMouseDown={handlePanMouseDown}
      onWheel={handleWheel}
      style={{
        width: '100%',
        height: '100%',
        cursor: isPanning ? 'grabbing' : (zoom > 1 ? 'grab' : (onSeek && !isRecording && duration > 0 ? 'pointer' : 'default')),
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        userSelect: 'none'
      }}
    >
      {channelMode && (
        <div className="waveform-channel-indicator">
          {channelMode.toUpperCase()}
        </div>
      )}
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block'
        }}
      />

      {/* Dimming Overlays */}
      {trimStart > 0 && trimStartPercent > 0 && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          height: '100%',
          width: `${Math.max(0, trimStartPercent)}%`,
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          pointerEvents: 'none'
        }} />
      )}

      {trimEnd > 0 && trimEnd < duration && trimEndPercent < 100 && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: `${Math.min(100, trimEndPercent)}%`,
          height: '100%',
          right: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          pointerEvents: 'none'
        }} />
      )}

      {/* Drag Handles */}
      {!isRecording && onTrimChange && duration > 0 && (
        <>
          {/* Start Handle */}
          {isStartHandleVisible && (
            <div
              onMouseDown={(e) => handleTrimMouseDown(e, 'start')}
              style={{
                position: 'absolute',
                top: 0,
                height: '100%',
                left: `${startHandlePercent}%`,
                width: '16px',
                marginLeft: '-8px',
                cursor: 'ew-resize',
                zIndex: 10,
                display: 'flex',
                justifyContent: 'center'
              }}
            >
              <div style={{
                width: '3px',
                height: '100%',
                backgroundColor: trimHandleColors[theme].start,
                boxShadow: `0 0 8px ${trimHandleColors[theme].start}80, 0 0 2px rgba(0,0,0,0.8)`
              }} />
              <div style={{
                position: 'absolute',
                top: '0',
                width: '16px',
                height: '20px',
                backgroundColor: trimHandleColors[theme].start,
                borderRadius: '0 0 4px 4px',
                boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <span style={{ fontSize: '10px', color: trimHandleColors[theme].startText, fontWeight: 'bold' }}>◀</span>
              </div>
              <div style={{
                position: 'absolute',
                bottom: '0',
                width: '16px',
                height: '20px',
                backgroundColor: trimHandleColors[theme].start,
                borderRadius: '4px 4px 0 0',
                boxShadow: '0 -2px 6px rgba(0,0,0,0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <span style={{ fontSize: '10px', color: trimHandleColors[theme].startText, fontWeight: 'bold' }}>◀</span>
              </div>
            </div>
          )}

          {/* End Handle */}
          {isEndHandleVisible && (
            <div
              onMouseDown={(e) => handleTrimMouseDown(e, 'end')}
              style={{
                position: 'absolute',
                top: 0,
                height: '100%',
                left: `${endHandlePercent}%`,
                width: '16px',
                marginLeft: '-8px',
                cursor: 'ew-resize',
                zIndex: 10,
                display: 'flex',
                justifyContent: 'center'
              }}
            >
              <div style={{
                width: '3px',
                height: '100%',
                backgroundColor: trimHandleColors[theme].end,
                boxShadow: `0 0 8px ${trimHandleColors[theme].end}80, 0 0 2px rgba(0,0,0,0.8)`
              }} />
              <div style={{
                position: 'absolute',
                top: '0',
                width: '16px',
                height: '20px',
                backgroundColor: trimHandleColors[theme].end,
                borderRadius: '0 0 4px 4px',
                boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <span style={{ fontSize: '10px', color: trimHandleColors[theme].endText, fontWeight: 'bold' }}>▶</span>
              </div>
              <div style={{
                position: 'absolute',
                bottom: '0',
                width: '16px',
                height: '20px',
                backgroundColor: trimHandleColors[theme].end,
                borderRadius: '4px 4px 0 0',
                boxShadow: '0 -2px 6px rgba(0,0,0,0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <span style={{ fontSize: '10px', color: trimHandleColors[theme].endText, fontWeight: 'bold' }}>▶</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
