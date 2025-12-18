import React, { useState, useEffect } from 'react';
import { convertAudioFormat } from '../utils/audioConverter';
import { getFileExtension } from '../utils/formatUtils';

interface Recording {
  id: string;
  name: string;
  timestamp: string;
  duration: number;
  audioData: number[];
  format?: string;
  channelMode?: string;
}

interface RecentRecordingsProps {
  onSelectRecording: (recording: Recording) => void;
  onDeleteRecording?: () => void;
}

export const RecentRecordings: React.FC<RecentRecordingsProps> = ({ onSelectRecording, onDeleteRecording }) => {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRecordings();
    
    // Listen for preference changes to reload recordings
    const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.preferences && changes.preferences.newValue) {
        // Format preference changed, reload recordings to get updated format
        loadRecordings();
      }
    };
    chrome.storage.onChanged.addListener(listener);
    
    return () => {
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);

  const loadRecordings = () => {
    chrome.storage.local.get(['savedRecordings'], (result) => {
      setRecordings(result.savedRecordings || []);
      setLoading(false);
    });
  };

  const handleDelete = (id: string) => {
    chrome.storage.local.get(['savedRecordings'], (result) => {
      const savedRecordings = result.savedRecordings || [];
      const filtered = savedRecordings.filter((r: Recording) => r.id !== id);
      chrome.storage.local.set({ savedRecordings: filtered });
      setRecordings(filtered);
      
      // Reset extension state when deleting
      if (onDeleteRecording) {
        onDeleteRecording();
      }
    });
  };

  const handleDownload = async (recording: Recording) => {
    // Always use current format preference (not the stored format)
    // This ensures all downloads use the current format setting
    const result = await chrome.storage.local.get(['preferences']);
    const format = result.preferences?.format || 'webm';
    const sampleRate = result.preferences?.sampleRate ? parseInt(result.preferences.sampleRate) : undefined;
    const channelMode = result.preferences?.channelMode || undefined;
    const targetChannels = channelMode === 'mono' ? 1 : channelMode === 'stereo' ? 2 : undefined;
    
    const audioArray = new Uint8Array(recording.audioData);
    const originalBlob = new Blob([audioArray], { type: 'audio/webm' });
    
    // Convert audio to the target format with sample rate and channel mode
    const convertedBlob = await convertAudioFormat(originalBlob, format, sampleRate, targetChannels);
    
    // Get file extension based on current format preference
    const extension = getFileExtension(format);
    
    // Update filename with correct extension
    let filename = recording.name;
    // Remove any existing extension
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');
    filename = `${nameWithoutExt}.${extension}`;
    
    const url = URL.createObjectURL(convertedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const getFileSize = (recording: Recording): number => {
    return recording.audioData ? recording.audioData.length : 0;
  };

  if (loading) {
    return (
      <div className="recent-recordings">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p className="loading-text">Loading recordings...</p>
        </div>
      </div>
    );
  }

  if (recordings.length === 0) {
    return (
      <div className="recent-recordings">
        <p className="empty-state">No recent recordings</p>
      </div>
    );
  }

  return (
    <div className="recent-recordings">
      <div className="recordings-list">
        {recordings.map((recording, index) => (
          <div key={recording.id} className="recording-item">
            {index === 0 && (
              <div className="recording-status-dot"></div>
            )}
            <div className="recording-info" onClick={() => onSelectRecording(recording)}>
              <div className="recording-name-row">
                <span className="recording-name">{recording.name.replace(/\.[^/.]+$/, '')}</span>
              </div>
              <div className="recording-date-row">
                <span className="recording-date-secondary">{formatDate(recording.timestamp)}</span>
                <span className="recording-channel-text">
                  ({(recording.channelMode || 'stereo').toUpperCase()})
                </span>
              </div>
            </div>
            <div className="recording-actions">
              <button 
                className="action-button" 
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectRecording(recording);
                }}
                title="Play"
              >
                <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                </svg>
              </button>
              <button 
                className="action-button" 
                onClick={(e) => {
                  e.stopPropagation();
                  handleDownload(recording);
                }}
                title="Download"
              >
                <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10 2a1 1 0 011 1v8.586l2.293-2.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 11.586V3a1 1 0 011-1z" />
                  <path d="M3 15a1 1 0 011 1h12a1 1 0 110 2H4a1 1 0 01-1-1z" />
                </svg>
              </button>
              <button 
                className="action-button delete-button" 
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(recording.id);
                }}
                title="Delete"
              >
                <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <div className="recording-meta-right">
              <div className="recording-file-size">{formatFileSize(getFileSize(recording))}</div>
              <div className="recording-duration">{formatTime(recording.duration)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

