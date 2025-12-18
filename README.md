# AudioSplitter Chrome Extension

A Chrome extension for splitting audio files directly in your browser.

## Features

- Split audio files into multiple segments
- Easy-to-use interface
- Support for various audio formats
- No server upload required - processing happens locally

## Installation

### From Source

1. Clone this repository:
   ```bash
   git clone https://github.com/yourusername/AudioSplitterChromeExtension.git
   cd AudioSplitterChromeExtension
   ```

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable "Developer mode" (toggle in the top right)

4. Click "Load unpacked" and select the extension directory

5. The extension should now appear in your Chrome toolbar

## Usage

1. Click the extension icon in your Chrome toolbar
2. Upload or select an audio file
3. Set your split points or duration
4. Click "Split" to process the audio
5. Download the split audio segments

## Development

### Project Structure

```
AudioSplitterChromeExtension/
├── manifest.json          # Extension manifest
├── popup.html             # Extension popup UI
├── popup.js               # Popup logic
├── background.js          # Background service worker (if needed)
├── content.js             # Content script (if needed)
├── styles/
│   └── popup.css          # Extension styles
└── icons/                 # Extension icons
```

### Building

This extension uses vanilla JavaScript and doesn't require a build step. Simply load the unpacked extension in Chrome for development.

## Requirements

- Google Chrome (latest version recommended)
- No additional dependencies required

## License

[Add your license here]

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

For issues, questions, or feature requests, please open an issue on GitHub.

