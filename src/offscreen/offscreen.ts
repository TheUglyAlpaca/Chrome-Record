export { };

let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target !== 'offscreen') return;

    if (message.type === 'START_RECORDING') {
        startRecording(message.streamId, message.data)
            .then(() => sendResponse({ success: true }))
            .catch((err) => sendResponse({ success: false, error: err.message }));
        return true; // Keep channel open
    } else if (message.type === 'STOP_RECORDING') {
        stopRecording();
        sendResponse({ success: true });
    }
});

async function startRecording(streamId: string, data: any) {
    if (mediaRecorder?.state === 'recording') {
        throw new Error('Called startRecording while already recording');
    }

    const media = await navigator.mediaDevices.getUserMedia({
        audio: {
            mandatory: {
                chromeMediaSource: 'tab',
                chromeMediaSourceId: streamId
            }
        } as any,
        video: false
    });

    // Continue to play the captured audio to the user.
    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(media);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;

    source.connect(analyser);
    source.connect(audioCtx.destination);

    // Start waveform broadcasting
    const waveformInterval = setInterval(() => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(dataArray);
            chrome.runtime.sendMessage({
                action: 'waveformUpdate',
                data: Array.from(dataArray)
            });
        }
    }, 16); // ~60 FPS

    mediaRecorder = new MediaRecorder(media, { mimeType: 'audio/webm' });
    recordedChunks = [];

    mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
            recordedChunks.push(event.data);
            // Send chunk to background/storage immediately
            const arrayBuffer = await event.data.arrayBuffer();
            chrome.runtime.sendMessage({
                action: 'addRecordingChunk',
                chunk: Array.from(new Uint8Array(arrayBuffer))
            });
        }
    };

    mediaRecorder.onstop = () => {
        clearInterval(waveformInterval);
        const blob = new Blob(recordedChunks, { type: 'audio/webm' });
        media.getTracks().forEach((t) => t.stop());
        audioCtx.close();
    };

    mediaRecorder.start(100);
}

function stopRecording() {
    if (mediaRecorder?.state === 'recording') {
        mediaRecorder.stop();
    }
}
