#!/bin/bash
# Installation script for SAM-Audio server
# Handles macOS ARM64 compatibility issues

set -e

echo "Setting up SAM-Audio server..."

# Check Python version
PYTHON_VERSION=$(python3 --version 2>&1 | awk '{print $2}' | cut -d. -f1,2)
if [[ "$PYTHON_VERSION" != "3.10" && "$PYTHON_VERSION" != "3.11" ]]; then
    echo "⚠️  Warning: Python 3.10 or 3.11 recommended (found $PYTHON_VERSION)"
    echo "   Installing Python 3.11 via Homebrew..."
    brew install python@3.11
    PYTHON_CMD="/opt/homebrew/bin/python3.11"
else
    PYTHON_CMD="python3"
fi

# Create virtual environment
echo "Creating virtual environment..."
$PYTHON_CMD -m venv venv

# Activate virtual environment
source venv/bin/activate

# Upgrade pip
echo "Upgrading pip..."
pip install --upgrade pip

# Install core dependencies
echo "Installing core dependencies..."
pip install flask flask-cors torch torchaudio numpy

# Try to install SAM-Audio
echo "Installing SAM-Audio..."
if pip install git+https://github.com/facebookresearch/sam-audio.git 2>&1 | tee install.log; then
    echo "✅ Installation successful!"
else
    echo "⚠️  Installation had some errors, but core functionality may still work."
    echo "   Check install.log for details."
    echo ""
    echo "   If decord failed, this is expected on macOS ARM64."
    echo "   The server should still work for basic audio separation."
fi

echo ""
echo "Next steps:"
echo "1. Authenticate with Hugging Face: huggingface-cli login"
echo "2. Request access to: https://huggingface.co/facebook/sam-audio-large"
echo "3. Run the server: source venv/bin/activate && python server.py"


