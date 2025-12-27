import { useState, useEffect, useRef, useCallback } from 'react';

interface WaveformData {
  data: Uint8Array;
  sampleRate: number;
  duration: number;
}

interface UseWaveformReturn {
  waveformData: WaveformData | null;
  liveWaveformDataRef: React.MutableRefObject<Uint8Array | null>;
  analyzeAudio: (audioBlob: Blob) => Promise<void>;
  analyzeStream: (stream: MediaStream) => Promise<void>;
  clearWaveform: () => void;
  listenForRemoteUpdates: () => () => void;
}

export function useWaveform(): UseWaveformReturn {
  const [waveformData, setWaveformData] = useState<WaveformData | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    // Initialize AudioContext
    audioContextRef.current = new AudioContext();
    analyserRef.current = audioContextRef.current.createAnalyser();
    analyserRef.current.fftSize = 2048;
    analyserRef.current.smoothingTimeConstant = 0.8;

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  const analyzeAudio = useCallback(async (audioBlob: Blob) => {
    if (!audioContextRef.current) return;

    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);

      // Get raw audio data for waveform visualization
      const channelData = audioBuffer.getChannelData(0); // Get first channel
      const samples = channelData.length;

      // Downsample for visualization (take every Nth sample)
      const targetSamples = 1000; // Number of bars to show
      const step = Math.max(1, Math.floor(samples / targetSamples));
      const waveformArray = new Uint8Array(targetSamples);

      for (let i = 0; i < targetSamples; i++) {
        const start = i * step;
        const end = Math.min(start + step, samples);
        let sum = 0;
        let max = 0;

        for (let j = start; j < end; j++) {
          const abs = Math.abs(channelData[j]);
          sum += abs;
          max = Math.max(max, abs);
        }

        // Normalize to 0-255 range
        const avg = sum / (end - start);
        waveformArray[i] = Math.min(255, Math.floor((avg + max) / 2 * 255));
      }

      setWaveformData({
        data: waveformArray,
        sampleRate: audioBuffer.sampleRate,
        duration: audioBuffer.duration
      });
    } catch (error) {
      console.error('Error analyzing audio:', error);
    }
  }, []);

  const analyzeStream = useCallback(async (stream: MediaStream) => {
    if (!audioContextRef.current || !analyserRef.current) return;

    try {
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);

      const bufferLength = analyserRef.current.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      // Reusable buffer for state updates to prevent GC pressure
      const stateBuffer = new Uint8Array(bufferLength);
      let frameCount = 0;

      const updateWaveform = () => {
        if (analyserRef.current) {
          frameCount++;
          // Only update state every 3rd frame (20fps instead of 60fps) to reduce CPU usage
          if (frameCount % 3 === 0) {
            analyserRef.current.getByteFrequencyData(dataArray);
            // Copy data to state buffer instead of creating new array
            stateBuffer.set(dataArray);
            setWaveformData({
              data: stateBuffer,
              sampleRate: audioContextRef.current?.sampleRate || 44100,
              duration: 0 // Will be updated by recording duration
            });
          }
        }
        animationFrameRef.current = requestAnimationFrame(updateWaveform);
      };

      updateWaveform();
    } catch (error) {
      console.error('Error analyzing stream:', error);
    }
  }, []);

  const clearWaveform = useCallback(() => {
    // Stop animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    // Clear waveform data immediately
    setWaveformData(null);
  }, []);

  const liveWaveformDataRef = useRef<Uint8Array | null>(null);

  const listenForRemoteUpdates = useCallback(() => {
    // Reusable buffer to prevent GC pressure
    let updateBuffer: Uint8Array | null = null;
    // Notify subscribers that new data is available (can be used to trigger a draw if loop is separate)
    // For now, we rely on the consumer (Waveform) polling the ref in rAF loop

    const listener = (message: any) => {
      if (message.action === 'waveformUpdate' && message.data) {
        const data = message.data;

        // Initialize or resize buffer if needed
        if (!updateBuffer || updateBuffer.length !== data.length) {
          updateBuffer = new Uint8Array(data.length);
        }

        // Copy data to reusable buffer
        for (let i = 0; i < data.length; i++) {
          updateBuffer[i] = data[i];
        }

        // Update the REF, not state - avoids React render cycle
        liveWaveformDataRef.current = updateBuffer;
      }
    };

    chrome.runtime.onMessage.addListener(listener);

    // Return cleanup function
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      liveWaveformDataRef.current = null;
    };
  }, []);

  return {
    waveformData,
    liveWaveformDataRef, // Expose the ref
    analyzeAudio,
    analyzeStream,
    clearWaveform,
    listenForRemoteUpdates
  };
}

