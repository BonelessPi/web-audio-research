# web-audio-research

This repository contains small experiments and demos I built while learning how to process audio directly in the browser using the Web Audio API and WebAssembly (via Emscripten). The work was done as part of my research this past semester and includes two main demos:

- **A real-time vocoder** implemented with C code compiled to WebAssembly, connected to Web Audio through an AudioWorklet.
- **A spectrogram visualizer** demonstrating audio analysis and time-frequency representation in the browser.

The repository is not intended to be a polished library or framework — it is primarily a learning space for myself, as well as anyone curious about combining Web Audio API with compiled DSP code.

## Installation / Building

These instructions assume you are using WSL (Windows Subsystem for Linux) or any Linux environment.

1. Install Emscripten (see https://emscripten.org/docs/getting_started/downloads.html)
2. Activate Emscripten in your shell: `source ./emsdk_env.sh`
3. Clone this repository if needed
4. Enter target directory
5. Build the project with `make`
6. Start a simple local server: `python3 -m http.server`
7. Open http://localhost:8000

Because Web Audio worklets and WASM require secure contexts, you cannot open the HTML files directly from disk — you must use a web server.

## Purpose of This Repository

This project represents my first deeper exploration into:

- Running DSP code in the browser
- Using Emscripten to compile C to WebAssembly
- Integrating native code with the Web Audio API
- Visualizing audio in real time
- Understanding the performance limits of Web Audio worklets
