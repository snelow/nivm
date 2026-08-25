# nivm

A personal project building a local AI assistant that acts as a bridge between a web frontend and Large Language Models (LLMs).

## Overview

`nivm` is a FastAPI-based backend that provides a flexible interface for interacting with LLMs. It operates in two distinct modes:

1. **Native Engine Mode**: Runs models directly on local hardware using `llama.cpp` and `llama_cpp_python`, providing deep integration for multimodal features (processing images, audio, and video).
2. **API Proxy Mode**: Acts as a proxy, forwarding requests to an external OpenAI-compatible API, such as a local LM Studio server.

The application includes a robust media processing pipeline using `OpenCV`, `PIL`, and `pydub` to handle file uploads (including extracting video frames and parsing audio) and translate them into formats understandable by vision/multimodal models.

## Features

- **Multimodal Support**: Extract frames from videos, parse audio files, and process static or animated images to send directly to LLMs.
- **Dual-Engine Setup**: Switch seamlessly between a native GGUF engine and an external API proxy.
- **Local Storage System**: JSON-based local persistence for settings, chat histories, and a memory key-value store.
- **FastAPI Backend**: Fast, asynchronous REST API with streaming response support.

## Getting Started
\* To be done \*

### Prerequisites

- Python 3.x
- `FFmpeg` (required by `pydub` for audio processing)
- **Model**: `gemma-4-E2B-it-Q4_K_M.gguf` (and its mmproj) is currently required for the native engine. This can be configured to any other model by modifying the code (dynamic support for other models will be implemented later).
- (Optional) CUDA/Metal toolkit for GPU acceleration if using the native engine.

### Installation

1. Clone the repository and navigate to the project directory.
2. Set up the Python virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows use `venv\Scripts\activate`
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
   *(Note: For media processing, you may also need to install `opencv-python`, `pillow`, and `pydub` if not fully covered in the base requirements.)*

### Usage

To start the backend server, you can use the provided script:
```bash
./run.sh
```
*(Alternatively, run `uvicorn main:app --host 127.0.0.1 --port 8000 --reload`)*

The frontend will be served at `http://127.0.0.1:8000/`.

## Note

This is a personal project aimed at providing a clean, hackable, and completely local AI environment. The architecture focuses on privacy, keeping user files and LLM processing local to your own hardware.

**Status:** This project is actively being developed locally and is not frequently updated on GitHub.
