import React, { useState, useEffect } from 'react';
import { getAllRecordingsMetadata, getRecording, saveRecording, RecordingMetadata } from '../utils/storageManager';
import { getFileExtension } from '../utils/formatUtils';

interface PreferencesProps {
  onClose?: () => void;
}

export const Preferences: React.FC<PreferencesProps> = ({ onClose }) => {
  const [format, setFormat] = useState<string>('wav');
  const [sampleRate, setSampleRate] = useState<string>('44100');
  const [channelMode, setChannelMode] = useState<string>('stereo');
  const [bitDepth, setBitDepth] = useState<string>('16');
  const [normalize, setNormalize] = useState<boolean>(false);
  const [useTabTitle, setUseTabTitle] = useState<boolean>(false);

  useEffect(() => {
    // Load saved preferences
    chrome.storage.local.get(['preferences'], (result) => {
      if (result.preferences) {
        const prefs = result.preferences;
        if (prefs.format) setFormat(prefs.format);
        if (prefs.sampleRate) setSampleRate(prefs.sampleRate);
        if (prefs.channelMode) setChannelMode(prefs.channelMode);
        if (prefs.bitDepth) setBitDepth(prefs.bitDepth);
        if (prefs.normalize !== undefined) setNormalize(prefs.normalize);
        if (prefs.useTabTitle !== undefined) setUseTabTitle(prefs.useTabTitle);
      }
    });
  }, []);

  const savePreferences = (
    newFormat?: string,
    newSampleRate?: string,
    newChannelMode?: string,
    newBitDepth?: string,
    newNormalize?: boolean,
    newUseTabTitle?: boolean
  ) => {
    chrome.storage.local.set({
      preferences: {
        format: newFormat !== undefined ? newFormat : format,
        sampleRate: newSampleRate !== undefined ? newSampleRate : sampleRate,
        channelMode: newChannelMode !== undefined ? newChannelMode : channelMode,
        bitDepth: newBitDepth !== undefined ? newBitDepth : bitDepth,
        normalize: newNormalize !== undefined ? newNormalize : normalize,
        useTabTitle: newUseTabTitle !== undefined ? newUseTabTitle : useTabTitle
      }
    });
  };

  const handleFormatChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newFormat = e.target.value;
    setFormat(newFormat);

    // Save the new format immediately with the new value
    savePreferences(newFormat);

    // Update all saved recordings to use the new format
    // Convert the audio data to the new format
    chrome.storage.local.get(['preferences'], async (prefsResult) => {
      try {
        // Get all recordings from IndexedDB
        const recordingsMetadata = await getAllRecordingsMetadata();
        if (recordingsMetadata.length === 0) return;

        // Import converter dynamically to avoid circular dependencies
        const { convertAudioFormat } = await import('../utils/audioConverter');

        // Get current sample rate and channel mode preferences
        const currentSampleRate = prefsResult.preferences?.sampleRate ? parseInt(prefsResult.preferences.sampleRate) : undefined;
        const currentChannelMode = prefsResult.preferences?.channelMode || undefined;
        const targetChannels = currentChannelMode === 'mono' ? 1 : currentChannelMode === 'stereo' ? 2 : undefined;

        // Convert all recordings to the new format
        for (const metadata of recordingsMetadata) {
          try {
            // Load full recording
            const fullRecording = await getRecording(metadata.id);
            if (!fullRecording) continue;

            // Reconstruct blob from ArrayBuffer
            const originalBlob = new Blob([fullRecording.audioData], { type: 'audio/webm' });

            // Convert to new format with sample rate and channel mode
            const convertedBlob = await convertAudioFormat(originalBlob, newFormat, currentSampleRate, targetChannels);
            const convertedArrayBuffer = await convertedBlob.arrayBuffer();

            // Update filename extension
            const extension = getFileExtension(newFormat);
            let recordingName = metadata.name;
            const nameWithoutExt = recordingName.replace(/\.[^/.]+$/, '');
            recordingName = `${nameWithoutExt}.${extension}`;

            // Save back to IndexedDB
            const updatedMetadata: RecordingMetadata = {
              ...metadata,
              name: recordingName,
              format: newFormat
            };

            await saveRecording(updatedMetadata, convertedArrayBuffer);
          } catch (error) {
            console.error(`Error converting recording ${metadata.id}:`, error);
          }
        }
      } catch (error) {
        console.error('Error updating recordings format:', error);
      }
    });
  };

  const handleSampleRateChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newSampleRate = e.target.value;
    setSampleRate(newSampleRate);
    savePreferences(undefined, newSampleRate);

    // Update all saved recordings to use the new sample rate
    chrome.storage.local.get(['preferences'], async (prefsResult) => {
      try {
        const recordingsMetadata = await getAllRecordingsMetadata();
        if (recordingsMetadata.length === 0) return;

        const { convertAudioFormat } = await import('../utils/audioConverter');
        const format = prefsResult.preferences?.format || 'webm';
        const channelMode = prefsResult.preferences?.channelMode || undefined;
        const targetChannels = channelMode === 'mono' ? 1 : channelMode === 'stereo' ? 2 : undefined;
        const targetSampleRate = parseInt(newSampleRate);

        for (const metadata of recordingsMetadata) {
          try {
            const fullRecording = await getRecording(metadata.id);
            if (!fullRecording) continue;

            const originalBlob = new Blob([fullRecording.audioData], { type: 'audio/webm' });
            const convertedBlob = await convertAudioFormat(originalBlob, format, targetSampleRate, targetChannels);
            const convertedArrayBuffer = await convertedBlob.arrayBuffer();

            await saveRecording(metadata, convertedArrayBuffer);
          } catch (error) {
            console.error(`Error converting recording ${metadata.id}:`, error);
          }
        }
      } catch (error) {
        console.error('Error updating recordings sample rate:', error);
      }
    });
  };

  const handleChannelModeChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newChannelMode = e.target.value;
    setChannelMode(newChannelMode);
    savePreferences(undefined, undefined, newChannelMode);

    // Update all saved recordings to use the new channel mode
    chrome.storage.local.get(['preferences'], async (prefsResult) => {
      try {
        const recordingsMetadata = await getAllRecordingsMetadata();
        if (recordingsMetadata.length === 0) return;

        const { convertAudioFormat } = await import('../utils/audioConverter');
        const format = prefsResult.preferences?.format || 'webm';
        const sampleRate = prefsResult.preferences?.sampleRate ? parseInt(prefsResult.preferences.sampleRate) : undefined;
        const targetChannels = newChannelMode === 'mono' ? 1 : newChannelMode === 'stereo' ? 2 : undefined;

        for (const metadata of recordingsMetadata) {
          try {
            const fullRecording = await getRecording(metadata.id);
            if (!fullRecording) continue;

            const originalBlob = new Blob([fullRecording.audioData], { type: 'audio/webm' });
            const convertedBlob = await convertAudioFormat(originalBlob, format, sampleRate, targetChannels);
            const convertedArrayBuffer = await convertedBlob.arrayBuffer();

            const updatedMetadata: RecordingMetadata = {
              ...metadata,
              channelMode: newChannelMode
            };

            await saveRecording(updatedMetadata, convertedArrayBuffer);
          } catch (error) {
            console.error(`Error converting recording ${metadata.id}:`, error);
          }
        }

        // Force a preference change to trigger RecentRecordings to reload after all conversions complete
        // This ensures the UI updates to show the correct channel mode icons
        savePreferences(undefined, undefined, newChannelMode);
      } catch (error) {
        console.error('Error updating recordings channel mode:', error);
      }
    });
  };

  const handleBitDepthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newBitDepth = e.target.value;
    setBitDepth(newBitDepth);
    savePreferences(undefined, undefined, undefined, newBitDepth);
  };

  const handleNormalizeToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newNormalize = e.target.checked;
    setNormalize(newNormalize);
    savePreferences(undefined, undefined, undefined, undefined, newNormalize);
  };

  const handleUseTabTitleToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newUseTabTitle = e.target.checked;
    setUseTabTitle(newUseTabTitle);
    savePreferences(undefined, undefined, undefined, undefined, undefined, newUseTabTitle);
  };

  return (
    <div className="preferences">
      <div className="preference-item" title="Choose between mono (1 channel) or stereo (2 channels) audio">
        <label className="preference-label">mono/stereo</label>
        <select
          className="preference-select"
          value={channelMode}
          onChange={handleChannelModeChange}
        >
          <option value="mono">mono</option>
          <option value="stereo">stereo</option>
        </select>
      </div>

      <div className="preference-item" title="Audio file format for exports (WAV: lossless, WebM/MP3/OGG: compressed)">
        <label className="preference-label">file type</label>
        <select
          className="preference-select"
          value={format}
          onChange={handleFormatChange}
        >
          <option value="wav">wav</option>
          <option value="webm">webm</option>
          <option value="mp3">mp3</option>
          <option value="ogg">ogg</option>
        </select>
      </div>

      <div className="preference-item" title="Number of audio samples per second (higher = better quality, larger file)">
        <label className="preference-label">sample rate</label>
        <select
          className="preference-select"
          value={sampleRate}
          onChange={handleSampleRateChange}
        >
          <option value="44100">44100</option>
          <option value="48000">48000</option>
          <option value="96000">96000</option>
          <option value="192000">192000</option>
        </select>
      </div>

      <div className="preference-item" title="Bit depth controls dynamic range (16-bit: CD quality, 24-bit: studio quality, 32-bit: maximum precision). Only applies to WAV files.">
        <label className="preference-label">bit depth</label>
        <select
          className="preference-select"
          value={bitDepth}
          onChange={handleBitDepthChange}
        >
          <option value="16">16-bit</option>
          <option value="24">24-bit</option>
          <option value="32">32-bit</option>
        </select>
      </div>

      <div className="preference-item" title="Automatically adjust volume to maximize loudness without clipping">
        <label className="preference-label">normalize audio</label>
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={normalize}
            onChange={handleNormalizeToggle}
          />
          <span className="toggle-slider"></span>
        </label>
      </div>

      <div className="preference-item" title="Use the browser tab's title as the default recording name">
        <label className="preference-label">use tab title as sample name</label>
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={useTabTitle}
            onChange={handleUseTabTitleToggle}
          />
          <span className="toggle-slider"></span>
        </label>
      </div>
    </div>
  );
};
