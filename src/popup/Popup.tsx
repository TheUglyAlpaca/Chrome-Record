import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { useAudioRecorder } from './hooks/useAudioRecorder';
import { useWaveform } from './hooks/useWaveform';
import { formatTime, formatDate, downloadAudio } from './utils/audioUtils';
import { getFileExtension } from './utils/formatUtils';
import { convertAudioFormat } from './utils/audioConverter';
import { saveRecording, migrateFromChromeStorage, updateRecordingName } from './utils/storageManager';
import { Waveform } from './components/Waveform';
import { AudioInfo } from './components/AudioInfo';
import { RecordingControls } from './components/RecordingControls';
import { RecordButton } from './components/RecordButton';
import { RecentRecordings } from './components/RecentRecordings';
import { Preferences } from './components/Preferences';
import { SAMProcessor } from './components/SAMProcessor';
import { BrainIcon } from './components/BrainIcon';
import './styles/popup.css';

const Popup: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'recording' | 'recent' | 'preferences' | 'ai'>('recording');
  const [recordingName, setRecordingName] = useState<string>('');
  const [recordingTimestamp, setRecordingTimestamp] = useState<Date>(new Date());
  const [currentRecordingId, setCurrentRecordingId] = useState<string | null>(null);
  const [currentRecordingChannelMode, setCurrentRecordingChannelMode] = useState<'mono' | 'stereo' | undefined>(undefined);
  const [zoom, setZoom] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [currentPlayTime, setCurrentPlayTime] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [isLightMode, setIsLightMode] = useState(false);
  const [preferences, setPreferences] = useState<{
    format?: string;
    sampleRate?: string;
    channelMode?: string;
    useTabTitle?: boolean;
  }>({});

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playIntervalRef = useRef<number | null>(null);
  const playheadAnimationFrameRef = useRef<number | null>(null);

  const {
    isRecording,
    audioBlob,
    duration: recordingDuration,
    startRecording,
    stopRecording,
    getAudioStream,
    checkRecordingState,
    setAudioBlob,
    setIsRecording,
    setDuration: setRecordingDuration
  } = useAudioRecorder();

  const {
    waveformData,
    analyzeAudio,
    analyzeStream,
    clearWaveform
  } = useWaveform();

  // Load all initial data in a single batch to reduce startup time
  useEffect(() => {
    // Batch all storage reads together
    chrome.storage.local.get(['migratedToIndexedDB', 'isLightMode', 'preferences'], async (result) => {
      // Set theme immediately (no async)
      if (result.isLightMode !== undefined) {
        setIsLightMode(result.isLightMode);
        document.body.classList.toggle('light-mode', result.isLightMode);
      }

      // Set preferences immediately
      if (result.preferences) {
        setPreferences(result.preferences);
      }

      // Check recording state (non-blocking)
      checkRecordingState();

      // Migrate in background (non-blocking, deferred)
      if (!result.migratedToIndexedDB) {
        // Defer migration to not block UI
        setTimeout(async () => {
          try {
            const count = await migrateFromChromeStorage();
            if (count > 0) {
              console.log(`Migrated ${count} recordings to IndexedDB`);
            }
            chrome.storage.local.set({ migratedToIndexedDB: true });
          } catch (error) {
            console.error('Migration error:', error);
          }
        }, 100);
      }
    });

    // Listen for preference changes
    const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.preferences) {
        setPreferences(changes.preferences.newValue || {});
      }
      if (changes.isLightMode) {
        setIsLightMode(changes.isLightMode.newValue || false);
        document.body.classList.toggle('light-mode', changes.isLightMode.newValue || false);
      }
    };
    chrome.storage.onChanged.addListener(listener);

    return () => {
      chrome.storage.onChanged.removeListener(listener);
    };
  }, [checkRecordingState]);

  // Update recording name and timestamp when recording starts
  useEffect(() => {
    if (isRecording) {
      const now = new Date();
      setRecordingTimestamp(now);
      // Only set default name if useTabTitle is disabled or tab title couldn't be retrieved
      if (!preferences.useTabTitle || !recordingName) {
        setRecordingName(`recording ${formatDate(now)}`);
      }
      setStartTime(0);
      setCurrentPlayTime(0);
    }
  }, [isRecording]);

  // Analyze stream when recording
  useEffect(() => {
    if (isRecording) {
      const stream = getAudioStream();
      if (stream) {
        analyzeStream(stream);
      }
    } else {
      // When recording stops, clear the live stream waveform
      // The full waveform will be shown from the audioBlob
      clearWaveform();
    }
  }, [isRecording, getAudioStream, analyzeStream, clearWaveform]);

  // Analyze audio blob when recording stops - show full waveform
  useEffect(() => {
    if (audioBlob && !isRecording) {
      console.log('Analyzing audio blob, size:', audioBlob.size);
      // Clear any existing waveform first
      clearWaveform();

      // Small delay to ensure stream analysis is stopped
      setTimeout(async () => {
        try {
          // Use the recording's original channel mode if available, otherwise use current preference
          const format = preferences.format || 'webm';
          const sampleRate = preferences.sampleRate ? parseInt(preferences.sampleRate) : undefined;
          const channelMode = currentRecordingChannelMode || preferences.channelMode || undefined;
          const targetChannels = channelMode === 'mono' ? 1 : channelMode === 'stereo' ? 2 : undefined;
          const convertedBlob = await convertAudioFormat(audioBlob, format, sampleRate, targetChannels);

          // Analyze the full audio to show complete waveform
          await analyzeAudio(convertedBlob);
          console.log('Audio analysis complete, waveform should be visible');

          // Create audio element for playback
          const audioUrl = URL.createObjectURL(convertedBlob);

          // Clean up old audio URL if exists
          if (audioRef.current && audioRef.current.src) {
            const oldUrl = audioRef.current.src;
            if (oldUrl.startsWith('blob:')) {
              URL.revokeObjectURL(oldUrl);
            }
          }

          // Create new audio element
          const audio = new Audio(audioUrl);
          audioRef.current = audio;

          // Set up event listeners
          audio.addEventListener('loadedmetadata', () => {
            // Audio is ready - immediately set current time to show playhead
            console.log('Audio loaded, duration:', audio.duration);
            setCurrentPlayTime(audio.currentTime || 0);
          });

          audio.addEventListener('ended', () => {
            setIsPlaying(false);
            setCurrentPlayTime(0);
          });

          // Don't use timeupdate event - it fires too infrequently (~250ms)
          // We'll use requestAnimationFrame for smooth updates instead

          audio.addEventListener('error', (e) => {
            console.error('Audio playback error:', e);
          });

          // Load the audio
          audio.load();

          // Reset play time to 0 when new recording is loaded
          setCurrentPlayTime(0);
          setStartTime(0);
        } catch (error) {
          console.error('Error analyzing audio:', error);
        }
      }, 100);
    }
  }, [audioBlob, isRecording, analyzeAudio, clearWaveform, preferences.format, currentRecordingChannelMode]);

  const getTabTitle = async (): Promise<string | null> => {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs.length > 0 && tabs[0].title) {
        return tabs[0].title;
      }
      return null;
    } catch (error) {
      console.error('Error getting tab title:', error);
      return null;
    }
  };

  const handleRecordClick = async () => {
    if (isRecording) {
      const stoppedBlob = await stopRecording();
      // Save recording to Recent Recordings after stopping
      // Use the current recordingName (which may have been edited)
      // Check for valid blob - at least 1KB to be considered valid
      if (stoppedBlob && stoppedBlob.size > 1024) {
        console.log('Recording stopped, blob size:', stoppedBlob.size);
        const nameToSave = recordingName || `recording ${formatDate(new Date())}`;
        console.log('Saving recording with name:', nameToSave);

        try {
          await saveRecordingToHistory(stoppedBlob, nameToSave);
          console.log('Recording saved to history successfully!');
        } catch (error: any) {
          console.error('Error saving recording to history:', error);
          const errorMessage = error?.message || 'Unknown error occurred';

          // Provide user-friendly message for quota exceeded
          if (errorMessage.includes('quota') || errorMessage.includes('Quota')) {
            alert('Storage limit reached. The oldest recordings have been removed to make space. Your new recording has been saved.');
          } else {
            alert(`Recording stopped but failed to save to recent recordings: ${errorMessage}`);
          }
        }
      } else {
        console.warn('No valid blob to save after stopping recording. Blob:', stoppedBlob);
        if (stoppedBlob) {
          console.warn('Blob exists but size is too small:', stoppedBlob.size, 'bytes (minimum 1KB required)');
          if (stoppedBlob.size > 0) {
            alert(`Recording captured but audio data is very small (${stoppedBlob.size} bytes). The recording may be corrupted or too short.`);
          } else {
            alert('Recording stopped but no audio data was captured. Please try recording again.');
          }
        } else {
          alert('Recording stopped but no audio data was captured. Please try recording again.');
        }
      }
    } else {
      // Clear previous recording state before starting new one
      if (audioRef.current) {
        audioRef.current.pause();
        if (audioRef.current.src && audioRef.current.src.startsWith('blob:')) {
          URL.revokeObjectURL(audioRef.current.src);
        }
        audioRef.current.src = '';
      }
      clearWaveform();
      setAudioBlob(null);
      setIsPlaying(false);
      setCurrentPlayTime(0);
      setStartTime(0);
      setCurrentRecordingChannelMode(undefined);

      // If useTabTitle is enabled, get the tab title and set it as the recording name
      if (preferences.useTabTitle) {
        const tabTitle = await getTabTitle();
        if (tabTitle) {
          // Clean up the tab title (remove invalid filename characters)
          const cleanedTitle = tabTitle.replace(/[<>:"/\\|?*]/g, '_').trim();
          if (cleanedTitle) {
            setRecordingName(cleanedTitle);
          }
        }
      } else {
        // Reset to default name format
        setRecordingName(`recording ${formatDate(new Date())}`);
      }

      try {
        await startRecording();
      } catch (error: any) {
        console.error('Failed to start recording:', error);
        const errorMessage = error?.message || 'Unknown error';
        // Only show user-friendly error, not technical details
        if (errorMessage.includes('MediaDevices API not available')) {
          alert('Recording failed: Browser API not available. Please try reloading the extension.');
        } else if (errorMessage.includes('No active tab')) {
          alert('Recording failed: No active tab found. Please open a tab and try again.');
        } else {
          alert(`Recording failed: ${errorMessage}`);
        }
      }
    }
  };

  const saveRecordingToHistory = async (blob: Blob, name: string): Promise<void> => {
    try {
      console.log('Starting to save recording to history, blob size:', blob.size);
      const format = preferences.format || 'webm';
      const sampleRate = preferences.sampleRate ? parseInt(preferences.sampleRate) : undefined;
      const channelMode = preferences.channelMode || undefined;
      const targetChannels = channelMode === 'mono' ? 1 : channelMode === 'stereo' ? 2 : undefined;
      const extension = getFileExtension(format);

      // Convert audio to the target format with sample rate and channel mode
      console.log('Converting audio format...');
      const convertedBlob = await convertAudioFormat(blob, format, sampleRate, targetChannels);
      console.log('Audio converted, converted blob size:', convertedBlob.size);

      // Update name with correct extension if needed
      let recordingName = name;
      if (!name.endsWith(`.${extension}`)) {
        // Remove any existing extension and add the correct one
        const nameWithoutExt = name.replace(/\.[^/.]+$/, '');
        recordingName = `${nameWithoutExt}.${extension}`;
      }

      console.log('Converting blob to array buffer...');
      const arrayBuffer = await convertedBlob.arrayBuffer();
      console.log('Array buffer converted, size:', arrayBuffer.byteLength);

      const recordingId = Date.now().toString();
      const metadata = {
        id: recordingId,
        name: recordingName,
        timestamp: new Date().toISOString(),
        duration: recordingDuration,
        format: format, // Store current format preference
        channelMode: preferences.channelMode || 'stereo' // Store channel mode
      };

      console.log('Recording metadata created, ID:', recordingId, 'Duration:', recordingDuration);

      // Store the current recording ID so we can update it later if name is edited
      setCurrentRecordingId(recordingId);

      // Save recording to IndexedDB (much larger capacity)
      try {
        await saveRecording(metadata, arrayBuffer);
        console.log('Recording saved to IndexedDB successfully! ID:', recordingId);
      } catch (error) {
        console.error('Error saving recording to IndexedDB:', error);
        throw error;
      }
    } catch (error) {
      console.error('Failed to save recording:', error);
      throw error; // Re-throw to be caught by caller
    }
  };

  // Smooth playhead update using requestAnimationFrame
  useEffect(() => {
    if (isPlaying && audioRef.current) {
      const updatePlayhead = () => {
        if (audioRef.current && isPlaying) {
          const currentTime = audioRef.current.currentTime;
          setCurrentPlayTime(currentTime);
          playheadAnimationFrameRef.current = requestAnimationFrame(updatePlayhead);
        }
      };

      // Start the animation loop
      playheadAnimationFrameRef.current = requestAnimationFrame(updatePlayhead);

      return () => {
        if (playheadAnimationFrameRef.current) {
          cancelAnimationFrame(playheadAnimationFrameRef.current);
          playheadAnimationFrameRef.current = null;
        }
      };
    } else {
      // Stop animation when not playing
      if (playheadAnimationFrameRef.current) {
        cancelAnimationFrame(playheadAnimationFrameRef.current);
        playheadAnimationFrameRef.current = null;
      }
    }
  }, [isPlaying]);

  const handlePlay = async () => {
    if (audioRef.current) {
      try {
        if (isPlaying) {
          audioRef.current.pause();
          setIsPlaying(false);
          if (playIntervalRef.current) {
            clearInterval(playIntervalRef.current);
            playIntervalRef.current = null;
          }
          if (playheadAnimationFrameRef.current) {
            cancelAnimationFrame(playheadAnimationFrameRef.current);
            playheadAnimationFrameRef.current = null;
          }
        } else {
          // Ensure audio is loaded
          if (audioRef.current.readyState < 2) {
            audioRef.current.load();
          }

          // Immediately update current time to show playhead before play starts
          setCurrentPlayTime(audioRef.current.currentTime || 0);

          await audioRef.current.play();
          setIsPlaying(true);

          // Update current time immediately after play starts
          setCurrentPlayTime(audioRef.current.currentTime || 0);

          if (isLooping) {
            audioRef.current.loop = true;
          } else {
            audioRef.current.loop = false;
          }
        }
      } catch (error) {
        console.error('Playback error:', error);
        // Try loading again if play failed
        if (audioRef.current) {
          audioRef.current.load();
          try {
            await audioRef.current.play();
            setIsPlaying(true);
          } catch (retryError) {
            console.error('Retry playback failed:', retryError);
          }
        }
      }
    }
  };

  const handleLoop = () => {
    setIsLooping(!isLooping);
    if (audioRef.current) {
      audioRef.current.loop = !isLooping;
    }
  };

  const handleReset = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      setCurrentPlayTime(0);
    }
  };

  const handleWaveformSeek = (time: number) => {
    if (audioRef.current && !isRecording) {
      audioRef.current.currentTime = time;
      setCurrentPlayTime(time);
    }
  };

  const handleZoomIn = () => {
    setZoom(Math.min(zoom * 1.5, 10));
  };

  const handleZoomOut = () => {
    setZoom(Math.max(zoom / 1.5, 0.1));
  };

  const handleDownload = async () => {
    if (audioBlob) {
      // Use current format preference, but preserve original channel mode for playback
      const format = preferences.format || 'webm';
      const sampleRate = preferences.sampleRate ? parseInt(preferences.sampleRate) : undefined;
      // For download, use current preference (user might want to convert)
      // But for playback, we use the original channel mode
      const channelMode = preferences.channelMode || undefined;
      const targetChannels = channelMode === 'mono' ? 1 : channelMode === 'stereo' ? 2 : undefined;
      const extension = getFileExtension(format);

      // Convert audio to the target format with sample rate and channel mode
      const convertedBlob = await convertAudioFormat(audioBlob, format, sampleRate, targetChannels);

      // Remove any existing extension from recording name
      const nameWithoutExt = (recordingName || 'recording').replace(/\.[^/.]+$/, '');
      const filename = `${nameWithoutExt}.${extension}`;
      downloadAudio(convertedBlob, filename);
    }
  };

  const handleDelete = async () => {
    // First, stop any active recording to clean up streams
    if (isRecording) {
      try {
        await stopRecording();
      } catch (error) {
        console.error('Error stopping recording during delete:', error);
      }
    }

    // Wait a moment to ensure streams are fully released
    await new Promise(resolve => setTimeout(resolve, 300));

    // Stop and clean up audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      if (audioRef.current.src && audioRef.current.src.startsWith('blob:')) {
        URL.revokeObjectURL(audioRef.current.src);
      }
      // Remove all event listeners by creating a new audio element
      audioRef.current = null;
    }

    // Clear play interval if it exists
    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }

    // Clear playhead animation frame if it exists
    if (playheadAnimationFrameRef.current) {
      cancelAnimationFrame(playheadAnimationFrameRef.current);
      playheadAnimationFrameRef.current = null;
    }

    // Clear all state to go back to default view
    setIsPlaying(false);
    setIsLooping(false);
    setCurrentPlayTime(0);
    setStartTime(0);
    setZoom(1);

    // Clear waveform data
    clearWaveform();

    // Clear recording-related state
    setRecordingName('');
    setRecordingTimestamp(new Date());
    setAudioBlob(null);
    setIsRecording(false);
    setRecordingDuration(0);
    setCurrentRecordingId(null);
    setCurrentRecordingChannelMode(undefined);

    // Clear background recording state and ensure streams are released
    try {
      await chrome.runtime.sendMessage({ action: 'clearRecording' });
      // Also explicitly stop any active capture
      await chrome.runtime.sendMessage({ action: 'stopCapture' });
    } catch (error) {
      console.error('Failed to clear recording in background:', error);
    }

    // Clear storage to ensure no stale stream IDs
    await chrome.storage.local.remove([
      'recordingStreamId',
      'recordingTabId',
      'recordingStartTime',
      'recordingChunks'
    ]);
  };

  const handleThemeToggle = () => {
    const newMode = !isLightMode;
    setIsLightMode(newMode);
    document.body.classList.toggle('light-mode', newMode);
    chrome.storage.local.set({ isLightMode: newMode });
  };

  const displayDuration = isRecording ? recordingDuration : (audioRef.current?.duration || 0);
  const displayTime = isRecording ? recordingDuration : currentPlayTime;
  const displayStartTime = startTime;

  return (
    <div className={`popup-container ${isLightMode ? 'light-mode' : ''}`} style={{ position: 'relative' }}>
      <header className="header">
        <h1 className="app-title">Sample</h1>
        <div className="header-actions">
          <button className="icon-button" title={isLightMode ? "Switch to Dark Mode" : "Switch to Light Mode"} onClick={handleThemeToggle}>
            {isLightMode ? (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" fillRule="evenodd" />
              </svg>
            )}
          </button>
          <button className="icon-button" title="Menu">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" />
            </svg>
          </button>
        </div>
      </header>

      <nav className="tabs">
        <button
          className={`tab ${activeTab === 'recording' ? 'active' : ''}`}
          onClick={() => setActiveTab('recording')}
        >
          Recording
        </button>
        <button
          className={`tab ${activeTab === 'recent' ? 'active' : ''}`}
          onClick={() => setActiveTab('recent')}
        >
          Recent Recordings
        </button>
        <button
          className={`tab ${activeTab === 'ai' ? 'active' : ''}`}
          onClick={() => setActiveTab('ai')}
        >
          AI
        </button>
        <button
          className={`tab ${activeTab === 'preferences' ? 'active' : ''}`}
          onClick={() => setActiveTab('preferences')}
        >
          Preferences
        </button>
      </nav>

      {activeTab === 'recording' && (
        <div className="recording-content">
          {recordingName && (
            <AudioInfo
              recordingName={recordingName}
              timestamp={recordingTimestamp}
              onDownload={audioBlob ? handleDownload : undefined}
              onDelete={audioBlob ? handleDelete : undefined}
              onNameChange={async (newName) => {
                setRecordingName(newName);
                // Update the name in IndexedDB if this recording is already saved
                if (currentRecordingId) {
                  try {
                    const format = preferences.format || 'webm';
                    const extension = getFileExtension(format);
                    const updatedName = newName.endsWith(`.${extension}`) ? newName : `${newName}.${extension}`;
                    await updateRecordingName(currentRecordingId, updatedName);
                  } catch (error) {
                    console.error('Error updating recording name:', error);
                  }
                }
              }}
            />
          )}

          <div className="waveform-container">
            <Waveform
              data={waveformData?.data || null}
              zoom={zoom}
              currentTime={displayTime}
              duration={displayDuration}
              onSeek={handleWaveformSeek}
              isRecording={isRecording}
              channelMode={currentRecordingChannelMode || (preferences.channelMode as 'mono' | 'stereo' | undefined)}
              barColor={isLightMode ? '#ff9500' : '#ff9500'}
              backgroundColor={isLightMode ? '#f5f5f5' : '#2a2a2a'}
            />
          </div>

          {/* Show play controls only when not recording and have audio */}
          {!isRecording && audioBlob && (
            <div className="playback-info">
              <span className="playback-hint">Click waveform to seek • Use controls to play</span>
            </div>
          )}

          <div className="time-indicators">
            <span className="time-label">time {formatTime(displayTime)}</span>
            <span className="time-label">start {formatTime(displayStartTime)}</span>
            <span className="time-label">length {formatTime(displayDuration)}</span>
          </div>

          <RecordingControls
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onPlay={handlePlay}
            onPause={handlePlay}
            onLoop={handleLoop}
            onReset={handleReset}
            isPlaying={isPlaying}
            isLooping={isLooping}
          />

          <div className="record-button-container">
            <RecordButton
              isRecording={isRecording}
              onClick={handleRecordClick}
            />
          </div>
        </div>
      )}

      {activeTab === 'recent' && (
        <div className="recent-recordings-wrapper">
          <RecentRecordings
            onSelectRecording={(recording) => {
              // Load selected recording
              const audioArray = new Uint8Array(recording.audioData);
              const blob = new Blob([audioArray], { type: 'audio/webm' });
              setAudioBlob(blob);
              // Set the name without extension for display
              const nameWithoutExt = recording.name.replace(/\.[^/.]+$/, '');
              setRecordingName(nameWithoutExt);
              setRecordingTimestamp(new Date(recording.timestamp));
              // Store the recording ID and channel mode so we can use original settings
              setCurrentRecordingId(recording.id);
              setCurrentRecordingChannelMode((recording.channelMode as 'mono' | 'stereo') || 'stereo');
              setActiveTab('recording');
            }}
            onDeleteRecording={handleDelete}
            onOpenAI={(recording) => {
              // Load selected recording for AI
              const audioArray = new Uint8Array(recording.audioData);
              const blob = new Blob([audioArray], { type: 'audio/webm' });
              setAudioBlob(blob);
              // Set the name without extension for display
              const nameWithoutExt = recording.name.replace(/\.[^/.]+$/, '');
              setRecordingName(nameWithoutExt);
              setRecordingTimestamp(new Date(recording.timestamp));
              // Store the recording ID and channel mode so we can use original settings
              setCurrentRecordingId(recording.id);
              setCurrentRecordingChannelMode((recording.channelMode as 'mono' | 'stereo') || 'stereo');
              setActiveTab('ai');
            }}
          />
        </div>
      )}

      {activeTab === 'ai' && (
        <div className="ai-content">
          {!audioBlob ? (
            <div className="ai-empty-state">
              <div className="ai-empty-icon">🎵</div>
              <h3 className="ai-empty-title">No Audio Loaded</h3>
              <p className="ai-empty-description">
                Record audio or select a recording from Recent Recordings to use AI processing.
              </p>
              <button
                className="ai-select-button"
                onClick={() => setActiveTab('recent')}
              >
                Go to Recent Recordings
              </button>
            </div>
          ) : (
            <div className="ai-processor-wrapper">
              <div className="ai-audio-info">
                <div className="ai-audio-name">{recordingName || 'Untitled Recording'}</div>
                {recordingName && (
                  <button
                    className="ai-load-button"
                    onClick={() => setActiveTab('recent')}
                    title="Select different recording"
                  >
                    Change Recording
                  </button>
                )}
              </div>
              <SAMProcessor
                audioBlob={audioBlob}
                onProcessed={async (processedBlob) => {
                  // Update the audio blob with processed version
                  setAudioBlob(processedBlob);
                  // Re-analyze waveform for the processed audio
                  await analyzeAudio(processedBlob);
                  // Update recording name to indicate it's been processed
                  const currentName = recordingName.replace(/\.[^/.]+$/, '');
                  setRecordingName(`${currentName} (processed)`);
                  // Switch to recording tab to see the processed audio
                  setActiveTab('recording');
                }}
              />
            </div>
          )}
        </div>
      )}

      {activeTab === 'preferences' && (
        <div className="preferences-wrapper">
          <Preferences />
        </div>
      )}

      {activeTab !== 'recent' && activeTab !== 'ai' && (
        <button
          className="buy-coffee-button"
          onClick={() => alert('In development')}
          title="Buy us a coffee"
        >
          ☕ Buy us a coffee
        </button>
      )}
    </div>
  );
};

// Initialize React app
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<Popup />);
}

export default Popup;

