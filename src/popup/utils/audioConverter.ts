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
 * Normalizes audio buffer to a target peak level (default -1 dB to avoid clipping)
 */
function normalizeAudioBuffer(
  audioBuffer: AudioBuffer,
  targetPeak: number = 0.95 // -1 dB approximately
): AudioBuffer {
  const numberOfChannels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const sampleRate = audioBuffer.sampleRate;

  // Find the maximum absolute value across all channels
  let maxPeak = 0;
  for (let channel = 0; channel < numberOfChannels; channel++) {
    const channelData = audioBuffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      const absSample = Math.abs(channelData[i]);
      if (absSample > maxPeak) {
        maxPeak = absSample;
      }
    }
  }

  // If audio is already silent or at target, return original
  if (maxPeak === 0 || maxPeak === targetPeak) {
    return audioBuffer;
  }

  // Calculate gain needed to reach target peak
  const gain = targetPeak / maxPeak;

  // Create new buffer with normalized audio
  const audioContext = new AudioContext();
  const normalizedBuffer = audioContext.createBuffer(numberOfChannels, length, sampleRate);

  // Apply gain to all channels
  for (let channel = 0; channel < numberOfChannels; channel++) {
    const sourceData = audioBuffer.getChannelData(channel);
    const targetData = normalizedBuffer.getChannelData(channel);

    for (let i = 0; i < length; i++) {
      targetData[i] = sourceData[i] * gain;
    }
  }

  return normalizedBuffer;
}

/**
 * Encodes an AudioBuffer to a WAV Blob with configurable bit depth
 */
function audioBufferToWav(audioBuffer: AudioBuffer, bitDepth: number = 16): Blob {
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

  // Convert to PCM based on bit depth
  let pcmData: ArrayBufferLike;
  let bytesPerSample: number;

  if (bitDepth === 16) {
    bytesPerSample = 2;
    const pcm = new Int16Array(interleaved.length);
    for (let i = 0; i < interleaved.length; i++) {
      const s = Math.max(-1, Math.min(1, interleaved[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    pcmData = pcm.buffer;
  } else if (bitDepth === 24) {
    bytesPerSample = 3;
    const pcm = new Uint8Array(interleaved.length * 3);
    for (let i = 0; i < interleaved.length; i++) {
      const s = Math.max(-1, Math.min(1, interleaved[i]));
      const val = s < 0 ? s * 0x800000 : s * 0x7FFFFF;
      const intVal = Math.round(val);
      const offset = i * 3;
      pcm[offset] = intVal & 0xFF;
      pcm[offset + 1] = (intVal >> 8) & 0xFF;
      pcm[offset + 2] = (intVal >> 16) & 0xFF;
    }
    pcmData = pcm.buffer;
  } else if (bitDepth === 32) {
    bytesPerSample = 4;
    const pcm = new Int32Array(interleaved.length);
    for (let i = 0; i < interleaved.length; i++) {
      const s = Math.max(-1, Math.min(1, interleaved[i]));
      pcm[i] = s < 0 ? s * 0x80000000 : s * 0x7FFFFFFF;
    }
    pcmData = pcm.buffer;
  } else {
    throw new Error(`Unsupported bit depth: ${bitDepth}`);
  }

  // Create WAV file
  const dataSize = pcmData.byteLength;
  const wavBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(wavBuffer);

  // WAV header
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // audio format (PCM)
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numberOfChannels * bytesPerSample, true); // byte rate
  view.setUint16(32, numberOfChannels * bytesPerSample, true); // block align
  view.setUint16(34, bitDepth, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // Write PCM data
  const pcmView = new Uint8Array(wavBuffer, 44);
  pcmView.set(new Uint8Array(pcmData));

  return new Blob([wavBuffer], { type: 'audio/wav' });
}

/**
 * Converts an audio blob to WAV format with optional sample rate and channel conversion
 */
export async function convertToWav(
  blob: Blob,
  targetSampleRate?: number,
  targetChannels?: number,
  bitDepth: number = 16
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

  return audioBufferToWav(audioBuffer, bitDepth);
}

/**
 * Crops an audio blob to the specified start and end times
 */
export async function cropAudioBlob(
  blob: Blob,
  startTime: number,
  endTime: number,
  bitDepth: number = 16
): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new AudioContext();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  const sampleRate = audioBuffer.sampleRate;
  const startSample = Math.floor(startTime * sampleRate);
  const endSample = Math.floor(endTime * sampleRate);
  const newLength = Math.max(0, endSample - startSample);

  if (newLength === 0 || startSample >= audioBuffer.length) {
    return blob; // Invalid crop, return original
  }

  const newBuffer = audioContext.createBuffer(
    audioBuffer.numberOfChannels,
    newLength,
    sampleRate
  );

  for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
    const channelData = audioBuffer.getChannelData(i);
    const newChannelData = newBuffer.getChannelData(i);

    // Copy the slice
    for (let j = 0; j < newLength; j++) {
      if (startSample + j < channelData.length) {
        newChannelData[j] = channelData[startSample + j];
      }
    }
  }

  return audioBufferToWav(newBuffer, bitDepth);
}

/**
 * Converts an audio blob to the specified format with optional sample rate and channel conversion
 */
export async function convertAudioFormat(
  blob: Blob,
  targetFormat: string,
  targetSampleRate?: number,
  targetChannels?: number,
  bitDepth: number = 16,
  normalize: boolean = false
): Promise<Blob> {
  const format = targetFormat.toLowerCase();

  // For formats that need conversion (wav, mp3, ogg), or if sample rate/channel conversion is needed
  const needsConversion = format === 'wav' || format === 'mp3' || format === 'ogg' || targetSampleRate || targetChannels || normalize;

  if (needsConversion) {
    // First, decode the audio to get an AudioBuffer
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

    // Apply normalization if enabled
    if (normalize) {
      audioBuffer = normalizeAudioBuffer(audioBuffer);
    }

    // Convert based on target format
    if (format === 'wav') {
      return audioBufferToWav(audioBuffer, bitDepth);
    }

    if (format === 'mp3') {
      return await convertToMp3(audioBuffer);
    }

    if (format === 'ogg') {
      return await convertToOgg(audioBuffer);
    }

    // Fallback to WAV for unknown formats
    return audioBufferToWav(audioBuffer, bitDepth);
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

/**
 * Converts an AudioBuffer to MP3 format using lamejs
 */
async function convertToMp3(audioBuffer: AudioBuffer): Promise<Blob> {
  // Dynamically import lamejs
  const lamejs = await import('lamejs');

  const sampleRate = audioBuffer.sampleRate;
  const numberOfChannels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;

  // Convert float samples to 16-bit PCM
  const leftChannel = audioBuffer.getChannelData(0);
  const rightChannel = numberOfChannels > 1 ? audioBuffer.getChannelData(1) : leftChannel;

  const left = new Int16Array(length);
  const right = new Int16Array(length);

  for (let i = 0; i < length; i++) {
    left[i] = Math.max(-32768, Math.min(32767, leftChannel[i] * 32768));
    right[i] = Math.max(-32768, Math.min(32767, rightChannel[i] * 32768));
  }

  // Initialize MP3 encoder
  const mp3encoder = new lamejs.Mp3Encoder(numberOfChannels, sampleRate, 128); // 128 kbps
  const mp3Data: Int8Array[] = [];

  // Encode in chunks
  const sampleBlockSize = 1152;
  for (let i = 0; i < length; i += sampleBlockSize) {
    const leftChunk = left.subarray(i, i + sampleBlockSize);
    const rightChunk = right.subarray(i, i + sampleBlockSize);
    const mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf);
    }
  }

  // Flush remaining data
  const mp3buf = mp3encoder.flush();
  if (mp3buf.length > 0) {
    mp3Data.push(mp3buf);
  }

  // Combine all chunks into a single Uint8Array for Blob compatibility
  const totalLength = mp3Data.reduce((acc, arr) => acc + arr.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of mp3Data) {
    combined.set(new Uint8Array(chunk.buffer), offset);
    offset += chunk.length;
  }

  return new Blob([combined], { type: 'audio/mp3' });
}

/**
 * Converts an AudioBuffer to OGG format using MediaRecorder
 */
async function convertToOgg(audioBuffer: AudioBuffer): Promise<Blob> {
  // Create an offline audio context to render the buffer
  const offlineContext = new OfflineAudioContext(
    audioBuffer.numberOfChannels,
    audioBuffer.length,
    audioBuffer.sampleRate
  );

  // Create a buffer source
  const source = offlineContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineContext.destination);
  source.start();

  // Render the audio
  const renderedBuffer = await offlineContext.startRendering();

  // Create a MediaStream from the rendered buffer
  const audioContext = new AudioContext();
  const mediaStreamDestination = audioContext.createMediaStreamDestination();
  const bufferSource = audioContext.createBufferSource();
  bufferSource.buffer = renderedBuffer;
  bufferSource.connect(mediaStreamDestination);

  // Use MediaRecorder to encode to OGG
  return new Promise((resolve, reject) => {
    const chunks: Blob[] = [];
    const mediaRecorder = new MediaRecorder(mediaStreamDestination.stream, {
      mimeType: 'audio/ogg; codecs=opus'
    });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunks.push(e.data);
      }
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'audio/ogg; codecs=opus' });
      resolve(blob);
    };

    mediaRecorder.onerror = (e) => {
      reject(new Error('MediaRecorder error'));
    };

    mediaRecorder.start();
    bufferSource.start();

    // Stop recording after the buffer duration
    setTimeout(() => {
      mediaRecorder.stop();
      bufferSource.stop();
      audioContext.close();
    }, (renderedBuffer.duration * 1000) + 100);
  });
}
