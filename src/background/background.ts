// Background service worker for handling desktop audio capture

let isRecording = false;
let recordingChunks: Blob[] = [];
let mediaRecorder: MediaRecorder | null = null;
let currentStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let destinationNode: MediaStreamAudioDestinationNode | null = null;

interface Message {
  action: string;
  streamId?: string;
  tabId?: number;
  chunk?: number[];
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message: Message, sender: chrome.runtime.MessageSender, sendResponse: (response: any) => void) => {
  if (message.action === 'startCapture') {
    // Automatically capture from current Chrome window/tab without showing picker
    const tabId = message.tabId || sender.tab?.id;
    
    if (tabId) {
      // Get streamId and return it to popup - popup will get the stream
      captureTabAudio(tabId)
        .then(() => {
          chrome.storage.local.get(['recordingStreamId'], (result) => {
            sendResponse({ success: true, streamId: result.recordingStreamId, method: 'tab' });
          });
        })
        .catch((error) => {
          sendResponse({ success: false, error: error.message });
        });
    } else {
      // Fallback: get current active tab and capture
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].id) {
          captureTabAudio(tabs[0].id)
            .then(() => {
              chrome.storage.local.get(['recordingStreamId'], (result) => {
                sendResponse({ success: true, streamId: result.recordingStreamId, method: 'tab' });
              });
            })
            .catch((error) => {
              sendResponse({ success: false, error: error.message });
            });
        } else {
          sendResponse({ success: false, error: 'No active tab found' });
        }
      });
    }
    return true; // Keep channel open for async response
  }

  if (message.action === 'startRecordingWithStream') {
    // Popup sends us the streamId to start recording in background
    if (message.streamId) {
      startRecordingFromStreamId(message.streamId)
        .then(() => {
          sendResponse({ success: true });
        })
        .catch((error) => {
          sendResponse({ success: false, error: error.message });
        });
    } else {
      sendResponse({ success: false, error: 'Stream ID required' });
    }
    return true;
  }

  if (message.action === 'stopCapture') {
    handleStopCapture()
      .then(async (audioBlob) => {
        if (audioBlob) {
          const arrayBuffer = await audioBlob.arrayBuffer();
          sendResponse({ success: true, audioBlob: Array.from(new Uint8Array(arrayBuffer)) });
        } else {
          sendResponse({ success: true, audioBlob: null });
        }
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (message.action === 'getRecordingState') {
    // Double-check state from storage to ensure accuracy
    chrome.storage.local.get(['recordingStartTime', 'recordingChunks'], (result) => {
      const hasActiveRecording = isRecording && (result.recordingStartTime || recordingChunks.length > 0);
      sendResponse({ 
        success: true,
        isRecording: hasActiveRecording,
        hasRecording: recordingChunks.length > 0 || (result.recordingChunks && result.recordingChunks.length > 0)
      });
    });
    return true;
  }

  if (message.action === 'getRecordingData') {
    if (recordingChunks.length > 0) {
      // Get format preference
      chrome.storage.local.get(['preferences'], (prefsResult) => {
        const format = prefsResult.preferences?.format || 'webm';
        let mimeType = 'audio/webm';
        
        if (format === 'ogg') {
          mimeType = 'audio/ogg';
        } else if (format === 'webm') {
          mimeType = 'audio/webm';
        }
        
        const blob = new Blob(recordingChunks, { type: mimeType });
        blob.arrayBuffer().then((arrayBuffer) => {
          sendResponse({ 
            success: true, 
            audioBlob: Array.from(new Uint8Array(arrayBuffer)),
            hasData: true
          });
        });
      });
      return true; // Keep channel open for async response
    } else {
      sendResponse({ success: true, hasData: false });
      return true;
    }
  }

  if (message.action === 'clearRecording') {
    console.log('clearRecording called - cleaning up all resources');
    
    // Stop any active recording first
    if (mediaRecorder && isRecording) {
      if (mediaRecorder.state === 'recording' || mediaRecorder.state === 'paused') {
        try {
          mediaRecorder.stop();
          console.log('Stopped MediaRecorder in clearRecording');
        } catch (e) {
          console.warn('Error stopping MediaRecorder:', e);
        }
      }
      mediaRecorder = null;
      isRecording = false;
    }
    
    // Clean up stream - CRITICAL: must stop all tracks to release the tab capture
    if (currentStream) {
      const tracks = currentStream.getTracks();
      console.log(`Stopping ${tracks.length} tracks in clearRecording`);
      tracks.forEach((track: MediaStreamTrack) => {
        track.stop();
        console.log('Stopped track:', track.id, 'readyState:', track.readyState);
      });
      // Don't null immediately - let tracks fully stop
      setTimeout(() => {
        currentStream = null;
        console.log('Stream set to null in clearRecording');
      }, 100);
    } else {
      currentStream = null;
    }
    
    // Clean up audio context
    if (audioContext) {
      audioContext.close().catch(() => {});
      audioContext = null;
    }
    destinationNode = null;
    
    // Clear chunks and storage
    recordingChunks = [];
    chrome.storage.local.remove([
      'recordingStreamId',
      'recordingTabId',
      'recordingStartTime',
      'recordingChunks'
    ], () => {
      console.log('Storage cleared in clearRecording');
      sendResponse({ success: true });
    });
    
    return true;
  }

  if (message.action === 'addRecordingChunk') {
    // Add chunk from popup recorder
    if (message.chunk) {
      const blob = new Blob([new Uint8Array(message.chunk)], { type: 'audio/webm' });
      recordingChunks.push(blob);
      // Store in storage for persistence
      chrome.storage.local.get(['recordingChunks'], async (result) => {
        const existingChunks = result.recordingChunks || [];
        const chunksArray = await Promise.all(
          recordingChunks.map(async (chunk) => {
            const arrayBuffer = await chunk.arrayBuffer();
            return Array.from(new Uint8Array(arrayBuffer));
          })
        );
        chrome.storage.local.set({ recordingChunks: chunksArray });
      });
    }
    sendResponse({ success: true });
    return true;
  }
});

// Automatically capture audio from a specific tab (no picker, without muting)
async function captureTabAudio(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    // First, ensure any existing stream is fully cleaned up
    // Chrome's tabCapture API requires that previous streams are fully released before capturing again
    
    // Wait longer to ensure any previous stream is fully released
    // This is critical to prevent "Cannot capture a tab with an active stream" errors
    setTimeout(() => {
      chrome.tabCapture.getMediaStreamId(
        { targetTabId: tabId },
        (streamId: string | undefined) => {
          if (chrome.runtime.lastError) {
            const errorMsg = chrome.runtime.lastError.message;
            // If error is about active stream, wait longer and retry multiple times
            if (errorMsg && (errorMsg.includes('active stream') || errorMsg.includes('Cannot capture'))) {
              // Retry with increasing delays
              let retryCount = 0;
              const maxRetries = 3;
              const retryDelay = 800; // Start with 800ms
              
              const retryCapture = () => {
                setTimeout(() => {
                  chrome.tabCapture.getMediaStreamId(
                    { targetTabId: tabId },
                    (retryStreamId: string | undefined) => {
                      if (chrome.runtime.lastError) {
                        const retryError = chrome.runtime.lastError.message;
                        if (retryError && (retryError.includes('active stream') || retryError.includes('Cannot capture')) && retryCount < maxRetries) {
                          retryCount++;
                          console.log(`Retry ${retryCount}/${maxRetries} for tab capture after active stream error`);
                          retryCapture();
                          return;
                        }
                        reject(new Error(retryError));
                        return;
                      }
                      if (!retryStreamId) {
                        reject(new Error('Failed to get media stream ID'));
                        return;
                      }
                      chrome.storage.local.set({ 
                        recordingStreamId: retryStreamId,
                        recordingTabId: tabId 
                      });
                      resolve();
                    }
                  );
                }, retryDelay * (retryCount + 1)); // Increase delay with each retry
              };
              
              retryCapture();
              return;
            }
            reject(new Error(errorMsg));
            return;
          }

          if (!streamId) {
            reject(new Error('Failed to get media stream ID'));
            return;
          }

          // Store streamId - the popup will use it to get the stream
          chrome.storage.local.set({ 
            recordingStreamId: streamId,
            recordingTabId: tabId 
          });
          
          resolve();
        }
      );
    }, 300); // Increased delay to ensure previous stream is released
  });
}

// Start recording from a streamId (called from popup after getting the stream)
async function startRecordingFromStreamId(streamId: string): Promise<void> {
  return new Promise(async (resolve, reject) => {
    try {
      // Get the stream using getUserMedia in background worker
      // Note: This may not work in all service worker contexts, but we'll try
      if (!navigator || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        // If getUserMedia not available, we'll rely on popup recording
        // Store streamId for popup to use
        chrome.storage.local.set({ recordingStreamId: streamId });
        isRecording = true;
        resolve();
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            // @ts-ignore - chromeMediaSource is a Chrome-specific constraint
            mandatory: {
              chromeMediaSource: 'tab',
              chromeMediaSourceId: streamId
            }
          } as any,
          video: false
        });

        currentStream = stream;
        
        // Get format preference
        chrome.storage.local.get(['preferences'], (prefsResult) => {
          const format = prefsResult.preferences?.format || 'webm';
          let mimeType = 'audio/webm';
          
          // Map format to MIME type
          if (format === 'ogg') {
            mimeType = 'audio/ogg';
          } else if (format === 'webm') {
            mimeType = 'audio/webm';
          } else {
            // For wav and mp3, MediaRecorder doesn't support them natively
            // Use webm as fallback
            mimeType = 'audio/webm';
          }
          
          // Create MediaRecorder in background worker
          mediaRecorder = new MediaRecorder(stream, {
            mimeType: mimeType
          });

          recordingChunks = [];
          mediaRecorder.ondataavailable = async (event) => {
            if (event.data.size > 0) {
              recordingChunks.push(event.data);
              // Store chunks in storage for persistence
              const chunksArray = await Promise.all(
                recordingChunks.map(async (chunk) => {
                  const arrayBuffer = await chunk.arrayBuffer();
                  return Array.from(new Uint8Array(arrayBuffer));
                })
              );
              chrome.storage.local.set({ recordingChunks: chunksArray });
            }
          };

          mediaRecorder.onstop = () => {
            // Recording stopped - blob will be created in handleStopCapture
            console.log('Background MediaRecorder stopped, chunks:', recordingChunks.length);
          };

          mediaRecorder.onerror = (event) => {
            console.error('MediaRecorder error:', event);
          };

          mediaRecorder.start(100); // Collect data every 100ms
          isRecording = true;
          
          // Store recording start time for persistence
          chrome.storage.local.set({ recordingStartTime: Date.now() });
          
          resolve();
        });
      } catch (getUserMediaError) {
        // If getUserMedia fails in service worker, fall back to popup recording
        console.warn('getUserMedia not available in service worker, using popup recording');
        chrome.storage.local.set({ recordingStreamId: streamId });
        isRecording = true;
        resolve();
      }
    } catch (error: any) {
      reject(error);
    }
  });
}

// Legacy function - kept for reference but not used
async function captureAllTabs(): Promise<void> {
  return new Promise(async (resolve, reject) => {
    try {
      // Get all Chrome tabs
      const tabs = await chrome.tabs.query({});
      
      if (tabs.length === 0) {
        reject(new Error('No tabs found'));
        return;
      }

      // Create audio context for mixing
      audioContext = new AudioContext();
      destinationNode = audioContext.createMediaStreamDestination();

      const streams: MediaStream[] = [];
      let capturedCount = 0;

      // Capture audio from each tab
      for (const tab of tabs) {
        if (!tab.id) continue;

        try {
          const streamId = await new Promise<string>((resolve, reject) => {
            chrome.tabCapture.getMediaStreamId(
              { targetTabId: tab.id },
              (streamId: string | undefined) => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                  return;
                }
                if (!streamId) {
                  reject(new Error('Failed to get stream ID'));
                  return;
                }
                resolve(streamId);
              }
            );
          });

          // Get the stream
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              // @ts-ignore
              mandatory: {
                chromeMediaSource: 'tab',
                chromeMediaSourceId: streamId
              }
            } as any,
            video: false
          });

          streams.push(stream);

          // Connect to audio context for mixing
          const source = audioContext!.createMediaStreamSource(stream);
          source.connect(destinationNode!);

          capturedCount++;
        } catch (error) {
          console.warn(`Failed to capture tab ${tab.id}:`, error);
          // Continue with other tabs
        }
      }

      if (capturedCount === 0) {
        reject(new Error('Failed to capture any tabs'));
        return;
      }

      // Use the mixed stream
      const mixedStream = destinationNode!.stream;
      currentStream = mixedStream;

      // Create MediaRecorder
      mediaRecorder = new MediaRecorder(mixedStream, {
        mimeType: 'audio/webm'
      });

      recordingChunks = [];
      mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          recordingChunks.push(event.data);
          // Store chunks in storage for persistence
          const chunksArray = await Promise.all(
            recordingChunks.map(async (chunk) => {
              const arrayBuffer = await chunk.arrayBuffer();
              return Array.from(new Uint8Array(arrayBuffer));
            })
          );
          chrome.storage.local.set({ recordingChunks: chunksArray });
        }
      };

      mediaRecorder.onstop = () => {
        // Clean up streams
        streams.forEach(stream => {
          stream.getTracks().forEach(track => track.stop());
        });
        if (audioContext) {
          audioContext.close();
          audioContext = null;
        }
        destinationNode = null;
      };

      mediaRecorder.onerror = (event) => {
        console.error('MediaRecorder error:', event);
      };

          mediaRecorder.start(100); // Collect data every 100ms
          isRecording = true;
          
          // Store recording start time for persistence
          chrome.storage.local.set({ recordingStartTime: Date.now() });
          
          resolve();
    } catch (error) {
      reject(error);
    }
  });
}

async function handleStartCapture(streamId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Get the stream using getUserMedia with chromeMediaSource
    navigator.mediaDevices.getUserMedia({
      audio: {
        // @ts-ignore - chromeMediaSource is a Chrome-specific constraint
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: streamId
        }
      } as any,
      video: false
    }).then((stream) => {
      currentStream = stream;
      
      // Create MediaRecorder
      mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm'
      });

      recordingChunks = [];
      mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          recordingChunks.push(event.data);
          // Store chunks in storage for persistence
          const chunksArray = await Promise.all(
            recordingChunks.map(async (chunk) => {
              const arrayBuffer = await chunk.arrayBuffer();
              return Array.from(new Uint8Array(arrayBuffer));
            })
          );
          chrome.storage.local.set({ recordingChunks: chunksArray });
        }
      };

      mediaRecorder.onstop = () => {
        // Recording stopped
      };

      mediaRecorder.onerror = (event) => {
        console.error('MediaRecorder error:', event);
      };

          mediaRecorder.start(100); // Collect data every 100ms
          isRecording = true;
          
          // Store recording start time for persistence
          chrome.storage.local.set({ recordingStartTime: Date.now() });
          
          resolve();
    }).catch((error) => {
      reject(error);
    });
  });
}

async function handleStopCapture(): Promise<Blob | null> {
  if (mediaRecorder && isRecording) {
    return new Promise((resolve) => {
      if (mediaRecorder) {
        // Request any remaining data before stopping
        if (mediaRecorder.state === 'recording') {
          try {
            mediaRecorder.requestData();
            console.log('Requested final data chunk before stopping');
          } catch (e) {
            console.warn('Could not request data before stopping:', e);
          }
        }
        
        // Store the onstop handler before stopping
        const originalOnStop = mediaRecorder.onstop;
        
        mediaRecorder.onstop = (event: Event) => {
          console.log('MediaRecorder onstop fired, chunks count:', recordingChunks.length);
          const totalSize = recordingChunks.reduce((sum, chunk) => sum + chunk.size, 0);
          console.log('Total chunks size:', totalSize);
          
          // Request data one more time in case there's remaining data
          if (mediaRecorder && mediaRecorder.state === 'inactive') {
            // Wait a bit for any final chunks
            setTimeout(() => {
              processStopCapture(resolve, originalOnStop);
            }, 100);
          } else {
            processStopCapture(resolve, originalOnStop);
          }
        };
        
        // Stop the recorder
        if (mediaRecorder.state === 'recording' || mediaRecorder.state === 'paused') {
          mediaRecorder.stop();
        } else {
          // Already stopped, process immediately
          processStopCapture(resolve, originalOnStop);
        }
      } else {
        resolve(null);
      }
    });
  }
  return Promise.resolve(null);
}

function processStopCapture(resolve: (blob: Blob | null) => void, originalOnStop: ((this: MediaRecorder, ev: Event) => any) | null) {
  console.log('Processing stop capture, chunks count:', recordingChunks.length);
          
  // Get format preference for blob type
  chrome.storage.local.get(['preferences'], (prefsResult) => {
    const format = prefsResult.preferences?.format || 'webm';
    let mimeType = 'audio/webm';
    
    if (format === 'ogg') {
      mimeType = 'audio/ogg';
    } else if (format === 'webm') {
      mimeType = 'audio/webm';
    }
    
    // Ensure we have chunks
    if (recordingChunks.length === 0) {
      console.warn('No recording chunks available when stopping');
      resolve(null);
      return;
    }
    
    const blob = new Blob(recordingChunks, { type: mimeType });
    console.log('Created blob, size:', blob.size, 'from', recordingChunks.length, 'chunks');
  
    if (originalOnStop && mediaRecorder) {
      try {
        originalOnStop.call(mediaRecorder, new Event('stop'));
      } catch (e) {
        console.warn('Error calling original onstop:', e);
      }
    }
    
    isRecording = false;
    const chunksToReturn = [...recordingChunks]; // Copy before clearing
    recordingChunks = []; // Clear chunks after creating blob
    
    // Clean up stream completely - stop all tracks first
    if (currentStream) {
      const tracks = currentStream.getTracks();
      tracks.forEach((track: MediaStreamTrack) => {
        track.stop();
        console.log('Stopped track:', track.id, 'readyState:', track.readyState);
      });
      // Wait longer for tracks to fully stop before nulling
      // This ensures Chrome's tabCapture API fully releases the stream
      setTimeout(() => {
        currentStream = null;
        console.log('Stream cleaned up and set to null');
      }, 200); // Increased from 50ms to 200ms
    } else {
      currentStream = null;
    }

    if (audioContext) {
      audioContext.close().catch(() => {
        // Ignore errors on close
      });
      audioContext = null;
    }
    destinationNode = null;
    
    // Clear all recording-related storage
    chrome.storage.local.remove([
      'recordingStreamId', 
      'recordingTabId', 
      'recordingStartTime',
      'recordingChunks'
    ]);
    
    const recorderToNull = mediaRecorder;
    mediaRecorder = null;
    
    // Resolve with the blob - check for minimum size (at least 1KB to be valid)
    if (blob.size > 1024) {
      console.log('Resolving with blob, size:', blob.size);
      resolve(blob);
    } else if (blob.size > 0) {
      console.warn('Blob size is very small:', blob.size, 'but resolving anyway');
      resolve(blob);
    } else {
      console.warn('Blob size is 0, trying to use chunks directly');
      // If blob is empty, try to create from chunks copy
      if (chunksToReturn.length > 0) {
        const retryBlob = new Blob(chunksToReturn, { type: mimeType });
        console.log('Retry blob size:', retryBlob.size);
        if (retryBlob.size > 0) {
          resolve(retryBlob);
        } else {
          console.error('Retry blob is also empty');
          resolve(null);
        }
      } else {
        console.warn('No chunks available, resolving with null');
        resolve(null);
      }
    }
  });
}

// Handle popup close - continue recording in background
chrome.runtime.onConnect.addListener((port) => {
  port.onDisconnect.addListener(() => {
    // Popup closed, but recording continues in background
    console.log('Popup closed, recording continues in background');
  });
});

// Clean up on extension unload
chrome.runtime.onSuspend.addListener(() => {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
  }
  if (currentStream) {
    currentStream.getTracks().forEach((track: MediaStreamTrack) => {
      track.stop();
    });
  }
  if (audioContext) {
    audioContext.close();
  }
});

// Restore recording state on startup
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get(['recordingChunks'], (result) => {
    if (result.recordingChunks && Array.isArray(result.recordingChunks)) {
      recordingChunks = result.recordingChunks.map((chunk: number[]) => 
        new Blob([new Uint8Array(chunk)], { type: 'audio/webm' })
      );
    }
  });
});
