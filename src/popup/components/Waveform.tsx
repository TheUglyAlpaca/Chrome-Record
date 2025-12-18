import React, { useEffect, useRef } from 'react';

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
}

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
  channelMode
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastPositionRef = useRef<number>(-1);
  const lastUpdateTimeRef = useRef<number>(Date.now());
  const lastKnownTimeRef = useRef<number>(0);
  const interpolatedPositionRef = useRef<number>(0);

  // Draw waveform (only when data changes)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Apply zoom scale to canvas dimensions for visual scaling
    const scale = zoom;
    const scaledWidth = width * scale;
    const scaledHeight = height * scale;
    canvas.width = scaledWidth;
    canvas.height = scaledHeight;

    // Clear canvas
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, scaledWidth, scaledHeight);

    // Draw waveform bars
    // Zoom in (zoom > 1): shows fewer bars (more detail per bar) and larger size
    // Zoom out (zoom < 1): shows more bars (less detail, see more of waveform) and smaller size
    const barCount = Math.floor(data.length / zoom);
    const barWidth = scaledWidth / barCount;
    const maxBarHeight = scaledHeight * 0.8;

    ctx.fillStyle = barColor;

    for (let i = 0; i < barCount; i++) {
      const dataIndex = Math.floor(i * zoom);
      const value = data[dataIndex] || 0;
      const barHeight = (value / 255) * maxBarHeight;
      const x = i * barWidth;
      const y = (scaledHeight - barHeight) / 2;

      ctx.fillRect(x, y, Math.max(1, barWidth - 1), barHeight);
    }
  }, [data, width, height, barColor, backgroundColor, zoom]);

  // Smooth playback position indicator using requestAnimationFrame
  useEffect(() => {
    if (duration <= 0 || !data) {
      // Clear position if no duration
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      lastPositionRef.current = -1;
      lastUpdateTimeRef.current = Date.now();
      lastKnownTimeRef.current = 0;
      interpolatedPositionRef.current = 0;
      return;
    }
    
    // Reset interpolation when currentTime changes significantly
    if (Math.abs(currentTime - lastKnownTimeRef.current) > 0.01) {
      lastUpdateTimeRef.current = Date.now();
      lastKnownTimeRef.current = currentTime;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Calculate scale once for this effect
    const scale = zoom;
    const scaledWidth = width * scale;
    const scaledHeight = height * scale;

    // Initialize position immediately if not set
    if (lastPositionRef.current < 0) {
      const initialPosition = (currentTime / duration) * scaledWidth;
      lastPositionRef.current = initialPosition;
      lastKnownTimeRef.current = currentTime;
      lastUpdateTimeRef.current = Date.now();
    }

    let isActive = true;

    const drawPosition = () => {
      if (!isActive || !canvas || !ctx || !data) return;

      const now = Date.now();
      
      // Calculate target position based on current time (on scaled canvas)
      const targetPosition = (currentTime / duration) * scaledWidth;
      
      // Check if currentTime has changed significantly (new update from audio)
      if (Math.abs(currentTime - lastKnownTimeRef.current) > 0.01) {
        // New update received, update target but keep smooth interpolation
        lastKnownTimeRef.current = currentTime;
        lastUpdateTimeRef.current = now;
      }
      
      // Always interpolate smoothly between last drawn position and target position
      const elapsed = now - lastUpdateTimeRef.current;
      const interpolationDuration = 100; // ms to smooth over
      const progress = Math.min(1, elapsed / interpolationDuration);
      
      // Use easing for smoother animation (ease-out)
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      
      // Ensure lastPosition is initialized
      if (lastPositionRef.current < 0) {
        lastPositionRef.current = targetPosition;
      }
      
      const position = lastPositionRef.current + 
        (targetPosition - lastPositionRef.current) * easedProgress;
      
      // Redraw the waveform area around the position line for smooth updates
      // Note: We need to use the current backgroundColor and barColor from props
      // These are captured in the closure, so we need to access them from the component props
      // For now, we'll use the refs or re-read from canvas context
      const currentBgColor = backgroundColor;
      const currentBarColor = barColor;
      const barCount = Math.floor(data.length / zoom);
      const barWidth = scaledWidth / barCount;
      const maxBarHeight = scaledHeight * 0.8;
      
      // Clear area around old position
      if (lastPositionRef.current >= 0) {
        const clearWidth = Math.max(3, barWidth * 3);
        ctx.fillStyle = currentBgColor;
        ctx.fillRect(
          Math.max(0, lastPositionRef.current - clearWidth / 2),
          0,
          clearWidth,
          scaledHeight
        );
        // Redraw bars in cleared area
        ctx.fillStyle = currentBarColor;
        const startBar = Math.max(0, Math.floor((lastPositionRef.current - clearWidth / 2) / barWidth));
        const endBar = Math.min(barCount, Math.ceil((lastPositionRef.current + clearWidth / 2) / barWidth));
        for (let i = startBar; i < endBar; i++) {
          const dataIndex = Math.floor(i * zoom);
          const value = data[dataIndex] || 0;
          const barHeight = (value / 255) * maxBarHeight;
          const x = i * barWidth;
          const y = (scaledHeight - barHeight) / 2;
          ctx.fillRect(x, y, Math.max(1, barWidth - 1), barHeight);
        }
      }
      
      // Draw new position line with anti-aliasing
      ctx.strokeStyle = '#888';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(position, 0);
      ctx.lineTo(position, scaledHeight);
      ctx.stroke();
      
      lastPositionRef.current = position;
      
      // Continue animation
      if (isActive && duration > 0) {
        animationFrameRef.current = requestAnimationFrame(drawPosition);
      }
    };

    // Start animation
    animationFrameRef.current = requestAnimationFrame(drawPosition);

    return () => {
      isActive = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [currentTime, duration, width, data, zoom, backgroundColor, barColor, height]);

  // Redraw waveform when colors change (theme change)
  useEffect(() => {
    if (data && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Apply zoom scale to canvas dimensions for visual scaling
      const scale = zoom;
      const scaledWidth = width * scale;
      const scaledHeight = height * scale;
      canvas.width = scaledWidth;
      canvas.height = scaledHeight;

      // Clear canvas with new background color
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, scaledWidth, scaledHeight);

      // Redraw waveform bars with new colors
      const barCount = Math.floor(data.length / zoom);
      const barWidth = scaledWidth / barCount;
      const maxBarHeight = scaledHeight * 0.8;

      ctx.fillStyle = barColor;

      for (let i = 0; i < barCount; i++) {
        const dataIndex = Math.floor(i * zoom);
        const value = data[dataIndex] || 0;
        const barHeight = (value / 255) * maxBarHeight;
        const x = i * barWidth;
        const y = (scaledHeight - barHeight) / 2;

        ctx.fillRect(x, y, Math.max(1, barWidth - 1), barHeight);
      }

      // Redraw position line if it exists
      if (lastPositionRef.current >= 0 && duration > 0) {
        ctx.strokeStyle = '#888';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(lastPositionRef.current, 0);
        ctx.lineTo(lastPositionRef.current, scaledHeight);
        ctx.stroke();
      }
    }
  }, [backgroundColor, barColor, data, width, height, zoom, duration]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeek || !duration || isRecording) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    // Adjust click position for zoom scale
    const scale = zoom;
    const containerCenterX = rect.width / 2;
    const clickOffsetFromCenter = x - containerCenterX;
    const scaledOffset = clickOffsetFromCenter / scale;
    const adjustedX = containerCenterX + scaledOffset;
    const percentage = Math.max(0, Math.min(1, adjustedX / rect.width));
    const seekTime = percentage * duration;
    
    onSeek(Math.max(0, Math.min(seekTime, duration)));
  };

  // Calculate scale based on zoom for visual scaling
  // zoom > 1 means zoom in (make larger), zoom < 1 means zoom out (make smaller)
  const scale = zoom;
  
  return (
    <div 
      ref={containerRef}
      onClick={handleClick}
      style={{
        width: '100%',
        height: '100%',
        cursor: onSeek && !isRecording && duration > 0 ? 'pointer' : 'default',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      {channelMode && (
        <div className="waveform-channel-indicator">
          {channelMode.toUpperCase()}
        </div>
      )}
      <div
        style={{
          transform: `scale(${scale})`,
          transformOrigin: 'center center',
          width: `${100 / scale}%`,
          height: `${100 / scale}%`,
          position: 'relative'
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            width: '100%',
            height: '100%',
            display: 'block'
          }}
        />
      </div>
    </div>
  );
};

