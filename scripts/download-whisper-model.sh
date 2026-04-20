#!/bin/bash
# Download the Whisper model for sherpa-onnx local transcription
# Run this once: bash scripts/download-whisper-model.sh

set -e

MODEL_DIR="models/sherpa-onnx-whisper-base.en"

if [ -d "$MODEL_DIR" ]; then
  echo "Model already exists at $MODEL_DIR"
  exit 0
fi

echo "Downloading Whisper base.en model for sherpa-onnx..."
mkdir -p models
cd models
curl -L -o model.tar.bz2 "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-base.en.tar.bz2"
tar -xjf model.tar.bz2
rm model.tar.bz2
echo "Done! Model saved to $MODEL_DIR"
