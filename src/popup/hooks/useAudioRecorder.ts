import { useState, useRef, useCallback, useEffect } from 'react';
import { getMimeTypeForFormat, isFormatSupported } from '../utils/formatUtils';

interface UseAudioRecorderReturn {
  isRecording: boolean;
  isPaused: boolean;
  audioBlob: Blob | null;
  duration: number;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<Blob | null>;
  pauseRecording: () => void;
  resumeRecording: () => void;
  getAudioStream: () => MediaStream | null;
  checkRecordingState: () => Promise<void>;
  setAudioBlob: (blob: Blob | null) => void;
  setIsRecording: (recording: boolean) => void;
  setDuration: (duration: number) => void;
}

export function useAudioRecorder(): UseAudioRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [duration, setDuration] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const durationIntervalRef = useRef<number | null>(null);

  // Check recording state on mount (in case popup was closed and reopened)
  useEffect(() => {
    checkRecordingState();
  }, []);

  const checkRecordingState = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getRecordingState' });
      if (response.success && response.isRecording) {
        setIsRecording(true);
        
        // Get the recording start time from storage to calculate accurate duration
        chrome.storage.local.get(['recordingStartTime', 'recordingStreamId'], (result) => {
          if (result.recordingStartTime) {
            const elapsed = (Date.now() - result.recordingStartTime) / 1000;
            setDuration(elapsed);
            startTimeRef.current = Date.now() - elapsed * 1000;
          } else {
            // Fallback: start from now
            startTimeRef.current = Date.now();
            setDuration(0);
            chrome.storage.local.set({ recordingStartTime: Date.now() });
          }
          
          // Start duration timer for background recording
          durationIntervalRef.current = window.setInterval(() => {
            const elapsed = (Date.now() - startTimeRef.current) / 1000;
            setDuration(elapsed);
          }, 10);
          
          // If we have a streamId, try to reconnect to the stream for visualization
          if (result.recordingStreamId) {
            // Don't try to reconnect - just let it record in background
            // The stream is already being recorded in background worker
          }
        });
        
        // Try to get existing recording data (partial recording)
        const dataResponse = await chrome.runtime.sendMessage({ action: 'getRecordingData' });
        if (dataResponse.success && dataResponse.hasData) {
          const audioArray = new Uint8Array(dataResponse.audioBlob);
          const blob = new Blob([audioArray], { type: 'audio/webm' });
          setAudioBlob(blob);
        }
      } else {
        // Not recording - clear any stale state
        chrome.storage.local.remove(['recordingStreamId', 'recordingTabId', 'recordingStartTime']);
      }
    } catch (error) {
      console.error('Error checking recording state:', error);
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      // Get format preference
      const prefsResult = await chrome.storage.local.get(['preferences']);
      const format = prefsResult.preferences?.format || 'webm';
      const mimeType = getMimeTypeForFormat(format);
      
      // CRITICAL: First, ensure any previous recording is fully stopped and cleaned up
      // This must happen before attempting to start a new recording
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track: MediaStreamTrack) => track.stop());
        streamRef.current = null;
      }
      
      // Stop any active recording in background and clear all streams
      try {
        await chrome.runtime.sendMessage({ action: 'clearRecording' });
      } catch (error) {
        console.warn('Error clearing previous recording:', error);
      }
      
      // Wait longer to ensure previous stream is fully released
      // Chrome's tabCapture API needs time to fully release the stream
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // Clear any previous recording state from storage
      await chrome.storage.local.remove(['recordingStreamId', 'recordingTabId', 'recordingStartTime', 'recordingChunks']);
      
      // Double-check that storage is cleared
      const checkStorage = await chrome.storage.local.get(['recordingStreamId', 'recordingTabId']);
      if (checkStorage.recordingStreamId || checkStorage.recordingTabId) {
        // If still present, wait a bit more and clear again
        await new Promise(resolve => setTimeout(resolve, 500));
        await chrome.storage.local.remove(['recordingStreamId', 'recordingTabId', 'recordingStartTime', 'recordingChunks']);
      }
      
      // Get current active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) {
        throw new Error('No active tab found');
      }

      // Request background script to automatically capture from current tab
      const response = await chrome.runtime.sendMessage({
        action: 'startCapture',
        tabId: tab.id
      });

      if (!response.success) {
        throw new Error(response.error || 'Failed to start capture');
      }

      // Get streamId from background response
      const streamId = response.streamId;
      const method = response.method || 'tab'; // 'desktop' or 'tab'
      
      if (!streamId) {
        throw new Error('No stream ID received from background');
      }

      // Get stream for recording and waveform visualization
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            // @ts-ignore - chromeMediaSource is a Chrome-specific constraint
            mandatory: {
              chromeMediaSource: method === 'desktop' ? 'desktop' : 'tab',
              chromeMediaSourceId: streamId
            }
          } as any,
          video: false
        });

        // Workaround for tabCapture muting: Create an AudioContext and play the captured audio
        // while also recording it. This way the user can still hear the audio through the extension.
        if (method === 'tab') {
          try {
            const audioContext = new AudioContext();
            const source = audioContext.createMediaStreamSource(stream);
            const destination = audioContext.createMediaStreamDestination();
            
            // Split the stream: one path for recording, one for playback
            source.connect(destination);
            // Play the audio through the extension's audio context so user can still hear it
            source.connect(audioContext.destination);
            
            // Use the destination stream for recording
            streamRef.current = destination.stream;
            
            // Store audioContext reference so it stays alive
            (window as any).__recordingAudioContext = audioContext;
          } catch (audioError) {
            console.warn('Could not create audio split, using stream directly:', audioError);
            // Fallback: use stream directly (will mute, but at least recording works)
            streamRef.current = stream;
          }
        } else {
          // Desktop capture doesn't mute, so use stream directly
          streamRef.current = stream;
        }

        // Send streamId to background to start recording there
        // This ensures recording continues when popup closes
        const bgResponse = await chrome.runtime.sendMessage({
          action: 'startRecordingWithStream',
          streamId: streamId
        });

        if (!bgResponse.success) {
          // If background recording fails, record in popup and send chunks to background
          const recorder = new MediaRecorder(stream, {
            mimeType: mimeType
          });

          chunksRef.current = [];
          recorder.ondataavailable = async (event) => {
            if (event.data.size > 0) {
              chunksRef.current.push(event.data);
              // Send chunks to background for persistence
              const arrayBuffer = await event.data.arrayBuffer();
              chrome.runtime.sendMessage({
                action: 'addRecordingChunk',
                chunk: Array.from(new Uint8Array(arrayBuffer))
              });
            }
          };

          recorder.onstop = async () => {
            if (chunksRef.current.length > 0) {
              const blob = new Blob(chunksRef.current, { type: mimeType });
              setAudioBlob(blob);
            }
          };

          mediaRecorderRef.current = recorder;
          recorder.start(100);
        } else {
          // Background is recording, but we also record locally as backup
          const localRecorder = new MediaRecorder(stream, {
            mimeType: mimeType
          });

          chunksRef.current = [];
          localRecorder.ondataavailable = async (event) => {
            if (event.data.size > 0) {
              chunksRef.current.push(event.data);
            }
          };

          localRecorder.onstop = async () => {
            // If we have local chunks, use them as backup
            if (chunksRef.current.length > 0) {
              const blob = new Blob(chunksRef.current, { type: mimeType });
              console.log('Local recorder stopped, blob size:', blob.size);
            }
          };

          mediaRecorderRef.current = localRecorder;
          localRecorder.start(100);
        }
      } catch (error) {
        console.error('Could not get stream:', error);
        throw error;
      }
      const startTime = Date.now();
      startTimeRef.current = startTime;
      setDuration(0);
      setAudioBlob(null);
      
      // Store start time for persistence
      chrome.storage.local.set({ recordingStartTime: startTime });

      // Start duration timer
      durationIntervalRef.current = window.setInterval(() => {
        const elapsed = (Date.now() - startTimeRef.current) / 1000;
        setDuration(elapsed);
      }, 10);

      setIsRecording(true);
      setIsPaused(false);
    } catch (error) {
      console.error('Error starting recording:', error);
      throw error;
    }
  }, []);

  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    if (isRecording) {
      // Stop local recorder if it exists
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        const recorder = mediaRecorderRef.current;
        await new Promise<void>((resolve) => {
          const originalOnStop = recorder.onstop;
          recorder.onstop = (event: Event) => {
            if (originalOnStop) {
              originalOnStop.call(recorder, event);
            }
            resolve();
          };
          recorder.stop();
        });
        mediaRecorderRef.current = null;
      }

      // Stop recording in background
      const response = await chrome.runtime.sendMessage({ action: 'stopCapture' });
      
      let finalBlob: Blob | null = null;
      
      if (response && response.success && response.audioBlob && response.audioBlob.length > 0) {
        const audioArray = new Uint8Array(response.audioBlob);
        finalBlob = new Blob([audioArray], { type: 'audio/webm' });
        console.log('Got blob from background, size:', finalBlob.size);
        setAudioBlob(finalBlob);
      } else if (chunksRef.current.length > 0) {
        // If no background blob, use local chunks
        finalBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
        console.log('Got blob from local chunks, size:', finalBlob.size);
        setAudioBlob(finalBlob);
      } else {
        // Try to get final blob from background chunks
        const dataResponse = await chrome.runtime.sendMessage({ action: 'getRecordingData' });
        if (dataResponse && dataResponse.success && dataResponse.hasData && dataResponse.audioBlob && dataResponse.audioBlob.length > 0) {
          const audioArray = new Uint8Array(dataResponse.audioBlob);
          finalBlob = new Blob([audioArray], { type: 'audio/webm' });
          console.log('Got blob from background data, size:', finalBlob.size);
          setAudioBlob(finalBlob);
        } else {
          console.warn('No audio blob available after stopping recording');
        }
      }
      
      // Clear chunks after creating blob
      chunksRef.current = [];

      if (streamRef.current) {
        // Clean up waveform analysis if it exists
        if ((streamRef.current as any).__waveformCleanup) {
          (streamRef.current as any).__waveformCleanup();
        }
        
        const tracks = streamRef.current.getTracks();
        tracks.forEach((track: MediaStreamTrack) => {
          track.stop();
          console.log('Stopped track in stopRecording:', track.id, 'readyState:', track.readyState);
        });
        streamRef.current = null;
        // Wait longer for tracks to fully stop - critical for tabCapture API
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }

      // Clean up audio context
      if ((window as any).__recordingAudioContext) {
        try {
          await (window as any).__recordingAudioContext.close();
        } catch (e) {
          // Ignore errors
        }
        delete (window as any).__recordingAudioContext;
      }

      // Clear recording start time and streamId from storage
      chrome.storage.local.remove(['recordingStartTime', 'recordingStreamId', 'recordingTabId']);

      setIsRecording(false);
      setIsPaused(false);
      
      // Return the blob so it can be used immediately
      return finalBlob;
    }
    return null;
  }, [isRecording]);

  const pauseRecording = useCallback(() => {
    // Pausing is handled by background worker
    if (isRecording && !isPaused) {
      setIsPaused(true);
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }
    }
  }, [isRecording, isPaused]);

  const resumeRecording = useCallback(() => {
    if (isRecording && isPaused) {
      setIsPaused(false);
      startTimeRef.current = Date.now() - duration * 1000;
      durationIntervalRef.current = window.setInterval(() => {
        const elapsed = (Date.now() - startTimeRef.current) / 1000;
        setDuration(elapsed);
      }, 10);
    }
  }, [isRecording, isPaused, duration]);

  const getAudioStream = useCallback(() => {
    return streamRef.current;
  }, []);

  return {
    isRecording,
    isPaused,
    audioBlob,
    duration,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    getAudioStream,
    checkRecordingState,
    setAudioBlob,
    setIsRecording,
    setDuration
  };
}
