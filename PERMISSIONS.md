# How to Grant Permissions for Audio Recording Extension

## Step-by-Step Instructions

### 1. Check Extension Permissions

1. Open Chrome and go to `chrome://extensions/`
2. Find your "Sample - Audio Recorder" extension
3. Click on **"Details"** button
4. Scroll down to **"Permissions"** section
5. Make sure you see:
   - ✅ Desktop capture
   - ✅ Active tab
   - ✅ Storage

### 2. Grant Desktop Capture Permission

When you click the **Record** button:

1. A Chrome system dialog will appear asking you to **"Choose what to share"**
2. You'll see a list of Chrome windows and tabs
3. **Select the Chrome window or tab** you want to record audio from
4. Click **"Share"** or **"Allow"** in the dialog

**Important:** You must select a source in this dialog. If you close it without selecting, recording will fail.

### 3. If Permission Dialog Doesn't Appear

If the picker dialog doesn't show up:

1. **Reload the extension:**
   - Go to `chrome://extensions/`
   - Find your extension
   - Click the reload icon (circular arrow)

2. **Check for errors:**
   - Right-click on the extension popup
   - Select "Inspect"
   - Check the Console tab for error messages

3. **Verify manifest permissions:**
   - The extension should have `desktopCapture` permission in `manifest.json`
   - This is already included, but verify it's there

### 4. Browser-Level Permissions

Chrome may also ask for system-level permissions:

- **macOS:** System Preferences → Security & Privacy → Screen Recording
  - Make sure Chrome has permission to record screen/audio
- **Windows:** Windows Settings → Privacy → Microphone/Camera
  - Ensure Chrome has access

### 5. Troubleshooting

**Error: "No source selected"**
- You closed the picker without selecting a source
- Solution: Click Record again and select a Chrome window/tab

**Error: "Failed to start capture"**
- The extension doesn't have proper permissions
- Solution: Reload the extension and try again

**Error: "No tab available"**
- No active tab was found
- Solution: Make sure you have at least one Chrome tab open

**Still having issues?**
1. Check the browser console for detailed error messages
2. Make sure you're using a recent version of Chrome
3. Try disabling and re-enabling the extension
4. Check if other extensions are interfering


