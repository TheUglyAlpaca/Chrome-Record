# Audio Splitter Chrome Extension

A Chrome extension for recording browser audio output with waveform visualization, playback controls, format conversion, and surgical sound isolation.

<div align="center">
  <table>
    <tr>
      <td width="50%" align="center">
        <img src="./Screenshot%202025-12-25%20at%206.13.47%E2%80%AFPM.png" width="350" alt="Recording View"><br>
        <em>Recording View (Theme 1)</em>
      </td>
      <td width="50%" align="center">
        <img src="./Screenshot%202025-12-25%20at%206.14.13%E2%80%AFPM.png" width="350" alt="Recent Recordings View"><br>
        <em>Recording View (Theme 2)</em>
      </td>
    </tr>
    <tr>
      <td width="50%" align="center">
        <img src="./Screenshot%202025-12-25%20at%206.19.24%E2%80%AFPM.png" width="350" alt="Theme 3 View"><br>
        <em>My Recordings Screen (Theme 3)</em>
      </td>
      <td width="50%" align="center">
        <img src="./Screenshot%202025-12-25%20at%206.19.34%E2%80%AFPM.png" width="350" alt="Theme 4 View"><br>
        <em>Settings (Theme 4)</em>
      </td>
    </tr>
  </table>
</div>

## Features

### Recording
- **Automatic Tab Audio Capture**: Records audio from the current Chrome tab automatically without requiring user selection.
- **Non-Muting Recording**: Audio continues to play through your speakers/headphones while recording.
- **Background Recording**: Recording continues even when the extension popup is closed.
- **Real-time Waveform Visualization**: See live waveform visualization while recording.
- **Tab Title Naming**: Optional automatic naming using the current tab title (available in Preferences).

### Playback & Controls
- **Play/Pause Controls**: Standard audio playback controls.
- **Waveform Scrubbing**: Click anywhere on the waveform to seek to that position.
- **Non-Destructive Trimming**: Use handles on the waveform to select a specific region for playback and export.
- **Smooth Playhead**: Interpolated playhead movement for smooth visual updates.
- **Vertical Zoom**: Zoom in/out to increase the waveform's vertical height for detailed manual alignment and viewing.
- **Return to Start**: Reset playback position to the beginning (or start of trim).
- **Loop Playback**: Toggle loop mode for continuous playback of the selected region.

### Format & Preferences
- **Full Format Support**: Record and export in **WAV**, **WEBM**, **MP3**, or **OGG** formats.
- **MP3 Encoding**: High-quality MP3 encoding using `lamejs`.
- **Automatic Conversion**: Existing recordings are automatically converted when format, sample rate, or channel preferences change.
- **Sample Rate Selection**: Choose from 44.1kHz, 48kHz, 96kHz, or 192kHz.
- **Channel Mode**: Select mono or stereo recording with visual icons in history.
- **Bit Depth (WAV)**: Choose 16-bit, 24-bit, or 32-bit for WAV exports.
- **Volume Normalization**: Optional automatic peak normalization to maximize loudness without clipping.
- **Persistent Preferences**: All settings are saved and persist across sessions.

### Recent Recordings
- **IndexedDB Storage**: Uses IndexedDB for high-capacity storage of up to 50 recordings.
- **Metadata View**: See file sizes, duration, timestamps, and channel modes (mono/stereo) at a glance.
- **Auto-Update**: Recordings list updates automatically when preferences (like format) change.
- **Quick Access**: Play, download, or delete any recording from your history.

### SAM Audio Isolation (Meta SAM-Audio)
- **Sound Isolation**: Isolate specific sounds from audio using text prompts.
- **Text Prompting**: Describe the sound you want to isolate (e.g., "A man speaking", "Guitar playing").
- **Residual Audio**: Option to get everything except the target sound.
- **Local Processing**: Runs via a local Python server for privacy and performance.

### UI/UX
- **Modern Design**: Sleek, clean interface using the Inter font.
- **Multiple Themes**: Choose between **Dark**, **Light**, **Midnight**, and **Forest** themes, each with unique icons and color palettes.
- **Responsive Layout**: Optimized to fit perfectly within the extension popup without unnecessary scrolling.
- **Status Indicators**: Visual feedback for active recording and background processing.

## Installation

### Prerequisites
- Node.js (v14 or higher)
- Python 3.10+ (for SAM Audio isolation feature)
- CUDA-compatible GPU (recommended for SAM Audio, but CPU works too)
- npm or yarn

### Build Instructions

1. Clone the repository:
```bash
git clone <repository-url>
cd AudioSplitterChromeExtension
```

2. Install dependencies:
```bash
npm install
```

3. Build the extension:
```bash
npm run build
```

4. Load the extension in Chrome:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select the `dist` directory from this project

## Usage

### Recording Audio

1. **Start Recording**:
   - Click the extension icon in Chrome's toolbar.
   - Click the red circular record button.
   - The button transforms into a square stop button while recording and pulses.

2. **During Recording**:
   - Audio continues playing normally.
   - Real-time waveform visualization appears.
   - Recording continues even if you close the popup.

3. **Stop Recording**:
   - Click the square stop button.
   - The full waveform appears with trim handles.
   - Recording is automatically saved to Recent Recordings.

### Playing & Editing

- **Play/Pause**: Use the play button in the center.
- **Trim**: Drag the colored handles at the start and end of the waveform to select a region.
- **Seek**: Click anywhere on the waveform to jump to that position.
- **Zoom**: Use the `+` and `-` buttons to adjust the vertical scale of the waveform.
- **Loop**: Toggle loop mode to repeat the trimmed area.

### Managing Recordings

- **Recent Recordings**: Click the center tab to view history.
- **Play/Load**: Click a recording's name or the play icon to load it into the main view.
- **Download**: Click the download icon. It will use your current format/sample rate preferences.
- **Delete**: Click the trash icon to permanently remove a recording.
- **AI Processing**: Click the brain icon to send a recording to the SAM Audio processor.

### Preferences

- **mono/stereo**: Switch between 1 and 2 channels.
- **file type**: Choose your export format (WAV, WEBM, MP3, OGG).
- **sample rate**: Up to 192kHz for high-fidelity capture.
- **bit depth**: Configurable for WAV files (16/24/32-bit).
- **normalize**: Peak normalization for consistent volume.
- **use tab title**: Automatically use the current tab's name for new recordings.

## Technical Details

### Architecture

- **Frontend**: React + TypeScript
- **Build Tool**: Webpack
- **Audio Engine**: 
  - Web Audio API for playback and analysis.
  - `lamejs` for MP3 encoding.
  - Custom PCM encoders for WAV (16/24/32-bit).
- **Chrome APIs**: 
  - `chrome.tabCapture` - For capturing tab audio.
  - `chrome.storage.local` - For preferences and settings.
  - `chrome.storage.session` - For temporary UI state.
- **Storage**: IndexedDB (via a custom `storageManager`) for large audio data, ensuring performance even with dozens of high-quality recordings.

### Storage Limits

- **Capacity**: Maximum 50 recordings.
- **Management**: Older recordings are automatically removed when the limit is reached.
- **Persistence**: Data survives browser restarts and extension updates.

### Permissions

- `tabCapture` - To capture audio from browser tabs.
- `tabs` - To access current tab information for naming.
- `storage` - To save recordings and preferences.
- `activeTab` - To interact with the current active tab.

## SAM Audio Integration

The extension includes integration with Meta's SAM-Audio model for isolating sounds from audio recordings.

### Setting Up SAM Audio Server

1. **Install Python Dependencies:**
   ```bash
   cd sam_server
   pip install -r requirements.txt
   ```

2. **Get Model Access:**
   - Request access to [SAM-Audio models on Hugging Face](https://huggingface.co/facebook/sam-audio-large)
   - Once approved, authenticate:
     ```bash
     huggingface-cli login
     ```
     Enter your Hugging Face access token when prompted.

3. **Start the Server:**
   ```bash
   python sam_server/server.py
   ```
   The server will run on `http://localhost:5000`.

4. **Use in Extension:**
   - Record or load an audio file.
   - Click the "AI" tab or the brain icon in history.
   - Enter a text description of the sound to isolate (or remove).
   - The processed audio will replace the current recording.

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
