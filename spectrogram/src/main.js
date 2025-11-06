// Simple, single-file spectrogram implementation.
// Behavior: each animation frame we draw a new vertical column representing the current frequency magnitude
// and shift the canvas left by 1 pixel so the spectrogram scrolls.

const wasmModule = await WebAssembly.compileStreaming(fetch('../build/stftinternal.wasm'));

const canvas = document.getElementById('spectrogram');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');

// Controls
const fileEl = document.getElementById('file');
const micBtn = document.getElementById('micBtn');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const fftSelect = document.getElementById('fftSize');
const smoothingEl = document.getElementById('smoothing');
const gainEl = document.getElementById('gain');

const marginLeft = 50;

// Audio graph objects
let audioCtx = null;
let sourceNode = null;
let stftNode = null;
let analyser = null;
let analyserDelayed = null;
let gainNode = null;
let micStream = null;
let rafId = null;

// Canvas pixel scaling
function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * devicePixelRatio);
    canvas.height = Math.floor(rect.height * devicePixelRatio);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function setStatus(s) { statusEl.textContent = 'Status: ' + s }

async function ensureAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        await audioCtx.audioWorklet.addModule('src/MyStftProcessor.js');
    }
}

async function createAnalyser() {
    await ensureAudioContext();
    const a = audioCtx.createAnalyser();
    a.fftSize = parseInt(fftSelect.value, 10);
    a.smoothingTimeConstant = parseFloat(smoothingEl.value);
    a.minDecibels = -100;
    a.maxDecibels = -20;
    return a;
}

async function createStftNode() {
    await ensureAudioContext();
    const windowSize = parseInt(fftSelect.value, 10);
    return new AudioWorkletNode(audioCtx, "my-stft-processor", {
        processorOptions: { wasmModule, windowSize, hopSize: windowSize / 2 }
    });
}

// Map a magnitude (0..255) to an RGB string using an HSL-ish colormap
function magnitudeToColor(v) {
    // v: 0..255 -> convert to hue 240 (blue) -> 0 (red)
    const norm = v / 255;
    const hue = 240 - norm * 240; // 240 -> 0
    const light = Math.min(80, 30 + norm * 70);
    return `hsl(${hue}deg 100% ${light}%)`;
}

function drawFrequencyAxis(h, bins) {
    ctx.fillStyle = '#9fb0c8';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    const sampleRate = audioCtx ? audioCtx.sampleRate : 44100;
    const nyquist = sampleRate / 2;
    const exponent = 0.6;

    const freqs = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    freqs.forEach(f => {
        if (f > nyquist) return;

        // convert frequency -> vertical pixel (log scale same as bins)
        const binIndex = (f / nyquist) * (bins - 1);

        const frac = Math.pow(binIndex / (bins - 1), 1 / exponent); // inverse of mapping
        const y = Math.round((1 - frac) * (h - 1));

        ctx.beginPath();
        ctx.moveTo(marginLeft - 5, y);
        ctx.lineTo(marginLeft, y);
        ctx.strokeStyle = '#555';
        ctx.stroke();

        ctx.fillText(formatFreq(f), marginLeft - 8, y);
    });
}

function formatFreq(f) {
    return f >= 1000 ? (f / 1000 + 'k') : f.toString();
}


function hslToRgb(h, s, l) {
    h /= 360;
    let r, g, b;
    if (s === 0) r = g = b = l;
    else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// Draw a column of frequency data (rightmost column) and shift the canvas left by 1 pixel
function drawSpectrogramColumn(freqArray, yStart = 0, yEnd = canvas.height) {
    const w = canvas.width;
    const h = yEnd - yStart;
    const img = ctx.createImageData(1, h);
    const bins = freqArray.length;

    for (let y = 0; y < h; y++) {
        const frac = 1 - y / (h - 1);
        const exponent = 0.6;
        const binIndex = Math.floor(Math.pow(frac, exponent) * (bins - 1));
        const v = freqArray[binIndex];

        const hue = 240 - (v / 255) * 240;
        const light = Math.min(85, 30 + (v / 255) * 70);
        const [r, g, b] = hslToRgb(hue, 1, light / 100);

        const idx = y * 4;
        img.data[idx] = r;
        img.data[idx + 1] = g;
        img.data[idx + 2] = b;
        img.data[idx + 3] = 255;
    }
    ctx.putImageData(img, w - 1, yStart);
}

async function startVisualizing() {
    if (!analyser) analyser = await createAnalyser();
    if (!analyserDelayed) analyserDelayed = await createAnalyser();
    const bins = analyser.frequencyBinCount;
    const data = new Uint8Array(bins);
    const dataDelayed = new Uint8Array(bins);

    function loop() {
        analyser.getByteFrequencyData(data);
        analyserDelayed.getByteFrequencyData(dataDelayed);

        // split canvas into two halves
        const h = canvas.height;
        const half = Math.floor(h / 2);

        // shift both halves
        const plotW = canvas.width - marginLeft;
        ctx.drawImage(canvas, marginLeft + 1, 0, plotW - 1, h, marginLeft, 0, plotW - 1, h);

        // draw original analyser (top half)
        drawSpectrogramColumn(data, 0, half);

        // draw delayed analyser (bottom half)
        drawSpectrogramColumn(dataDelayed, half, h);

        rafId = requestAnimationFrame(loop);
    }
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
    setStatus('running');
}

function stopVisualizing() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    setStatus('stopped');
}

// Connect a MediaStream (mic) or MediaElement (file) to the analyser and start
async function connectSource(node) {
    await ensureAudioContext();
    await audioCtx.suspend()
    if (sourceNode) try { sourceNode.disconnect(); } catch (e) { }

    sourceNode = node;

    if (stftNode) {
        stftNode.port.postMessage({ type: "shutdown" });
        stftNode.port.close?.()
        stftNode.disconnect();
    }
    stftNode = await createStftNode();

    if (gainNode) {
        gainNode.disconnect();
    }
    gainNode = audioCtx.createGain();
    gainNode.gain.value = parseFloat(gainEl.value);

    if (analyser) {
        analyser.disconnect();
    }
    analyser = await createAnalyser();
    if (analyserDelayed) {
        analyserDelayed.disconnect();
    }
    analyserDelayed = await createAnalyser();

    // Routing: source → gain → [stft + none] → destination
    sourceNode.connect(gainNode);
    gainNode.connect(analyser);
    gainNode.connect(stftNode);
    stftNode.connect(analyserDelayed);
    //gainNode.connect(audioCtx.destination);
    stftNode.connect(audioCtx.destination);

    await startVisualizing();
}

// File input handling — create an <audio> element and connect it
fileEl.addEventListener('change', async (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    const audio = new Audio();
    audio.src = url;
    audio.controls = false;
    audio.loop = true;
    await audio.play().catch(() => { });
    const src = audioCtx.createMediaElementSource(audio);
    await connectSource(src);
    await audioCtx.resume();
    setStatus('playing file: ' + f.name);
});

// Microphone handling
micBtn.addEventListener('click', async () => {
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('getUserMedia not supported');
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        await ensureAudioContext();
        const src = audioCtx.createMediaStreamSource(micStream);
        await connectSource(src);
        await audioCtx.resume();
        setStatus('microphone active');
    } catch (err) {
        console.error(err);
        setStatus('microphone error: ' + (err.message || err));
    }
});

// Buttons
startBtn.addEventListener('click', async () => {
    // resume context if needed
    await ensureAudioContext();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    // if we have an analyser but no source, create one from the default output (not always possible). We rely on user to select file/mic.
    if (!sourceNode) { setStatus('please load a file or enable microphone'); return; }
    if (!rafId) await startVisualizing();
});

stopBtn.addEventListener('click', () => {
    stopVisualizing();
    try {
        if (micStream) {
            micStream.getTracks().forEach(t => t.stop());
            micStream = null;
        }
    } catch (e) { }
    if (sourceNode && sourceNode.mediaElement) {
        try {
            sourceNode.mediaElement.pause();
        } catch (e) { }
    }
    audioCtx.suspend();
    setStatus('stopped');
});

// Update analyser when controls change
fftSelect.addEventListener('change', async () => {
    const fftSize = parseInt(fftSelect.value, 10);
    if (analyser) { analyser.fftSize = fftSize; }
    if (analyserDelayed) { analyserDelayed.fftSize = fftSize; }
    if (stftNode) {
        stftNode.port.postMessage({ type: "shutdown" });
        stftNode.port.close?.()
        stftNode.disconnect();
        stftNode = await createStftNode();
        gainNode.connect(stftNode);
        stftNode.connect(analyserDelayed);
        stftNode.connect(audioCtx.destination);
    }
});
smoothingEl.addEventListener('input', () => {
    if (analyser) { analyser.smoothingTimeConstant = parseFloat(smoothingEl.value); }
    if (analyserDelayed) { analyserDelayed.smoothingTimeConstant = parseFloat(smoothingEl.value); }
});
gainEl.addEventListener('input', () => {
    if (gainNode) gainNode.gain.value = parseFloat(gainEl.value);
});

// initialize a small silent audio context so Mobile browsers allow resume on user gesture
document.addEventListener('click', async function _init() {
    document.removeEventListener('click', _init);
    await ensureAudioContext();
    // create a short silent buffer to prime audio context
    const buf = audioCtx.createBuffer(1, 1, audioCtx.sampleRate);
    const s = audioCtx.createBufferSource();
    s.buffer = buf;
    s.start(0);
    s.connect(audioCtx.destination);
    setStatus('idle');
});

// initial canvas fill
resizeCanvas();