// Audio format conversion utilities

/**
 * Resamples audio buffer to target sample rate using linear interpolation
 */
function resampleAudioBuffer(
  audioBuffer: AudioBuffer,
  targetSampleRate: number
): AudioBuffer {
  const sourceSampleRate = audioBuffer.sampleRate;
  
  // If sample rates match, return original
  if (sourceSampleRate === targetSampleRate) {
    return audioBuffer;
  }
  
  const numberOfChannels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const ratio = sourceSampleRate / targetSampleRate;
  const newLength = Math.round(length / ratio);
  
  // Create new buffer with target sample rate
  const audioContext = new AudioContext();
  const newBuffer = audioContext.createBuffer(numberOfChannels, newLength, targetSampleRate);
  
  // Simple linear interpolation resampling
  for (let channel = 0; channel < numberOfChannels; channel++) {
    const sourceData = audioBuffer.getChannelData(channel);
    const targetData = newBuffer.getChannelData(channel);
    
    for (let i = 0; i < newLength; i++) {
      const sourceIndex = i * ratio;
      const index = Math.floor(sourceIndex);
      const fraction = sourceIndex - index;
      
      if (index + 1 < length) {
        targetData[i] = sourceData[index] * (1 - fraction) + sourceData[index + 1] * fraction;
      } else {
        targetData[i] = sourceData[Math.min(index, length - 1)];
      }
    }
  }
  
  return newBuffer;
}

/**
 * Converts audio buffer channels (stereo to mono or mono to stereo)
 */
function convertChannels(
  audioBuffer: AudioBuffer,
  targetChannels: number
): AudioBuffer {
  const sourceChannels = audioBuffer.numberOfChannels;
  
  // If channels match, return original
  if (sourceChannels === targetChannels) {
    return audioBuffer;
  }
  
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  const newBuffer = new AudioContext().createBuffer(targetChannels, length, sampleRate);
  
  if (targetChannels === 1 && sourceChannels === 2) {
    // Stereo to mono: average the channels
    const leftChannel = audioBuffer.getChannelData(0);
    const rightChannel = audioBuffer.getChannelData(1);
    const monoChannel = newBuffer.getChannelData(0);
    
    for (let i = 0; i < length; i++) {
      monoChannel[i] = (leftChannel[i] + rightChannel[i]) / 2;
    }
  } else if (targetChannels === 2 && sourceChannels === 1) {
    // Mono to stereo: duplicate the channel
    const monoChannel = audioBuffer.getChannelData(0);
    const leftChannel = newBuffer.getChannelData(0);
    const rightChannel = newBuffer.getChannelData(1);
    
    for (let i = 0; i < length; i++) {
      leftChannel[i] = monoChannel[i];
      rightChannel[i] = monoChannel[i];
    }
  }
  
  return newBuffer;
}

/**
 * Converts an audio blob to WAV format with optional sample rate and channel conversion
 */
export async function convertToWav(
  blob: Blob,
  targetSampleRate?: number,
  targetChannels?: number
): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new AudioContext();
  let audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  
  // Apply sample rate conversion if specified
  if (targetSampleRate && audioBuffer.sampleRate !== targetSampleRate) {
    audioBuffer = resampleAudioBuffer(audioBuffer, targetSampleRate);
  }
  
  // Apply channel conversion if specified
  if (targetChannels && audioBuffer.numberOfChannels !== targetChannels) {
    audioBuffer = convertChannels(audioBuffer, targetChannels);
  }
  
  // Get final audio data
  const sampleRate = audioBuffer.sampleRate;
  const numberOfChannels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  
  // Interleave audio data
  const interleaved = new Float32Array(length * numberOfChannels);
  for (let i = 0; i < length; i++) {
    for (let channel = 0; channel < numberOfChannels; channel++) {
      interleaved[i * numberOfChannels + channel] = audioBuffer.getChannelData(channel)[i];
    }
  }
  
  // Convert to 16-bit PCM
  const pcm = new Int16Array(interleaved.length);
  for (let i = 0; i < interleaved.length; i++) {
    const s = Math.max(-1, Math.min(1, interleaved[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  
  // Create WAV file
  const wavBuffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(wavBuffer);
  
  // WAV header
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };
  
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // audio format (PCM)
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numberOfChannels * 2, true); // byte rate
  view.setUint16(32, numberOfChannels * 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, pcm.length * 2, true);
  
  // Write PCM data
  const pcmView = new Int16Array(wavBuffer, 44);
  pcmView.set(pcm);
  
  return new Blob([wavBuffer], { type: 'audio/wav' });
}

/**
 * Converts an audio blob to the specified format with optional sample rate and channel conversion
 */
export async function convertAudioFormat(
  blob: Blob,
  targetFormat: string,
  targetSampleRate?: number,
  targetChannels?: number
): Promise<Blob> {
  const format = targetFormat.toLowerCase();
  
  // For formats that need conversion (wav, mp3), or if sample rate/channel conversion is needed
  // we need to go through WAV conversion first
  const needsConversion = format === 'wav' || format === 'mp3' || targetSampleRate || targetChannels;
  
  if (needsConversion) {
    // Convert to WAV with sample rate and channel conversion
    let wavBlob = await convertToWav(blob, targetSampleRate, targetChannels);
    
    // If target format is WAV, return it
    if (format === 'wav') {
      return wavBlob;
    }
    
    // For MP3, we'd need a library like lamejs
    // For now, convert to WAV as a fallback
    if (format === 'mp3') {
      console.warn('MP3 conversion not yet implemented, converting to WAV instead');
      return wavBlob;
    }
    
    // For other formats, if we needed conversion, return the converted WAV
    // Otherwise, we'd need to re-encode to the target format
    return wavBlob;
  }
  
  // If already in the target format and no conversion needed, return as-is
  if (format === 'webm' && blob.type.includes('webm')) {
    return blob;
  }
  
  if (format === 'ogg' && blob.type.includes('ogg')) {
    return blob;
  }
  
  // Default: return original blob
  return blob;
}

