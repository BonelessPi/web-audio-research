// main.js — refactored and updated
// Note: this file expects the WASM and MyVocoder worklet the same as before.

const wasmModule = await WebAssembly.compileStreaming(fetch('../build/vocoderinternal.wasm'));

// TODO disable and mute stop button when not playing
// TODO fix issue where osc never starts again after instr file used
// TODO test general
// TODO modify osc freq slider range?
// TODO replace old version?
// TODO implement subband vocoding in C and propagate change in calling
// TODO add outline to stop
// TODO disable start button while playing
// TODO add reset to the files to restart from beginning
// TODO stop the top buttons from moving

///// DOM /////
const canvas = document.getElementById('spectrogram');
const topStatusEl = document.getElementById('topStatus');
const statusEl = document.getElementById('status');

// voice UI
const micBtn = document.getElementById('micBtn');
const voiceFileInput = document.getElementById('voiceFileInput');
const voiceDot = document.getElementById('voiceDot');
const voiceSourceLabel = document.getElementById('voiceSourceLabel');
const voiceStatus = document.getElementById('voiceStatus');
const voiceFileName = document.getElementById('voiceFileName');

// instrument UI
const instrOscBtn = document.getElementById('instrOscBtn');
const instrFileBtn = document.getElementById('instrFileBtn');
const instrFileInput = document.getElementById('instrFileInput');
const instrDot = document.getElementById('instrDot');
const instrSourceLabel = document.getElementById('instrSourceLabel');
const instrStatus = document.getElementById('instrStatus');
const instrFileName = document.getElementById('instrFileName');

// osc controls
const oscType = document.getElementById('oscType');
const oscFreq = document.getElementById('oscFreq');
const oscFreqReadout = document.getElementById('oscFreqReadout');

// general controls
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const fftSelect = document.getElementById('fftSize');
const smoothingEl = document.getElementById('smoothing');
const gainEl = document.getElementById('gain');

// canvas helpers
const marginLeft = 50;
const ctx = canvas.getContext('2d');

///// Audio graph state /////
let audioCtx = null;
let vocoderNode = null;
let gainNode = null;
let analyser = null;
let analyserDelayed = null;

let voiceNode = null;     // will be a MediaStreamSource, MediaElementSource, or silent BufferSource
let instrNode = null;     // will be an OscillatorNode (special) or MediaElementSource or silent BufferSource
let osc = null;           // OscillatorNode if in use
let micStream = null;

let rafId = null;

// UI state
let usingOsc = true; // default

///// Canvas setup /////
function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * devicePixelRatio);
    canvas.height = Math.floor(rect.height * devicePixelRatio);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

///// Utility UI functions /////
function setTopStatus(s) {
    topStatusEl.textContent = 'Status: ' + s;
}
function setStatus(s) {
    statusEl.textContent = 'Status: ' + s;
}
function setVoiceStatus(s) {
    voiceStatus.textContent = s;
}
function setVoiceActive(active, label = '') {
    voiceDot.classList.toggle('active', !!active);
    voiceSourceLabel.textContent = label || (active ? 'Microphone' : 'No input');
}
function setInstrActive(active, label = '') {
    instrDot.classList.toggle('active', !!active);
    instrSourceLabel.textContent = label || (active ? 'Instrument' : 'No input');
}
function setVoiceFileName(name) {
    voiceFileName.textContent = name || '—';
}
function setInstrFileName(name) {
    instrFileName.textContent = name || '—';
}
function enableStartIfReady() {
    // simple readiness: a voice source exists (mic or file) AND (instr: either osc selected OR file loaded)
    const voiceReady = !!voiceNode || !!micStream;
    const instrReady = usingOsc || !!instrNode;
    startBtn.disabled = !(voiceReady && instrReady);
    startBtn.classList.toggle('muted', startBtn.disabled);
}

///// Audio context helpers /////
async function ensureAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        await audioCtx.audioWorklet.addModule('src/MyVocoder.js');
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

async function createVocoderNode() {
    await ensureAudioContext();
    const windowSize = parseInt(fftSelect.value, 10);
    return new AudioWorkletNode(audioCtx, "my-vocoder", {
        numberOfInputs: 2,
        numberOfOutputs: 1,
        processorOptions: {
            wasmModule,
            windowSize,
            hopSize: windowSize>>1,
            melNumBands: 128,
            melFreqMin: 0,
            melFreqMax: 4000
        }
    });
}

///// Visualizer /////
function magnitudeToColor(v) {
    const norm = v / 255;
    const hue = 240 - norm * 240;
    const light = Math.min(80, 30 + norm * 70);
    return `hsl(${hue}deg 100% ${light}%)`;
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

        const h = canvas.height;
        const half = Math.floor(h / 2);

        const plotW = canvas.width - marginLeft;
        ctx.drawImage(canvas, marginLeft + 1, 0, plotW - 1, h, marginLeft, 0, plotW - 1, h);

        // original analyser (top)
        drawSpectrogramColumn(data, 0, half);
        // delayed analyser (bottom)
        drawSpectrogramColumn(dataDelayed, half, h);

        rafId = requestAnimationFrame(loop);
    }
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
}

function stopVisualizing() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
}

///// Audio graph creation / teardown /////
async function recreateAudioGraph() {
    await ensureAudioContext();

    // make sure we have sane nodes: if missing, create silent buffer sources to keep graph stable
    if (!voiceNode) {
        voiceNode = audioCtx.createBufferSource();
        voiceNode.buffer = audioCtx.createBuffer(1, 1, audioCtx.sampleRate);
        voiceNode.start(0);
    } else {
        try { voiceNode.disconnect(); } catch (e) {}
    }

    if (!instrNode) {
        instrNode = audioCtx.createBufferSource();
        instrNode.buffer = audioCtx.createBuffer(1, 1, audioCtx.sampleRate);
        instrNode.start(0);
    } else {
        try { if (instrNode) instrNode.disconnect(); } catch (e) {}
    }

    // teardown old vocoder node
    if (vocoderNode) {
        try {
            vocoderNode.port.postMessage({ type: "shutdown" });
            vocoderNode.port.close?.();
            vocoderNode.disconnect();
        } catch (e) {}
        vocoderNode = null;
    }
    vocoderNode = await createVocoderNode();

    if (gainNode) {
        try { gainNode.disconnect(); } catch (e) {}
    }
    gainNode = audioCtx.createGain();
    gainNode.gain.value = parseFloat(gainEl.value);

    // create or refresh analysers
    if (analyser) {
        try { analyser.disconnect(); } catch (e) {}
    }
    analyser = await createAnalyser();

    if (analyserDelayed) {
        try { analyserDelayed.disconnect(); } catch (e) {}
    }
    analyserDelayed = await createAnalyser();

    // Setup sources:
    // Voice -> gain -> analyser -> vocoder input 0
    voiceNode.connect(gainNode);
    gainNode.connect(analyser);
    analyser.connect(vocoderNode, 0, 0);

    // Instrument: either oscillator (create & start) -> analyserDelayed -> vocoder input 1
    if (usingOsc) {
        // if an existing oscillator exists, stop it
        if (osc) {
            try { osc.stop(); } catch (e) {}
            try { osc.disconnect(); } catch (e) {}
            osc = null;
        }

        osc = audioCtx.createOscillator();
        osc.type = oscType.value;
        osc.frequency.value = Number(oscFreq.value);
        // connect oscillator to analyserDelayed
        osc.start();
        instrNode = osc; // keep reference for playback/pause logic
    }

    instrNode.connect(analyserDelayed);
    analyserDelayed.connect(vocoderNode, 0, 1);

    vocoderNode.connect(audioCtx.destination);
}

async function stopAudioGraph() {
    if (!audioCtx) return;
    try { await audioCtx.suspend(); } catch (e) {}
    stopVisualizing();

    // stop/cleanup oscillator if present
    if (osc) {
        try { osc.stop(); } catch (e) {}
        try { osc.disconnect(); } catch (e) {}
        osc = null;
    }

    // pause media elements if any
    if (voiceNode && voiceNode.mediaElement) {
        try { voiceNode.mediaElement.pause(); } catch (e) {}
    }
    if (instrNode && instrNode.mediaElement) {
        try { instrNode.mediaElement.pause(); } catch (e) {}
    }

    try {
        if (micStream) {
            micStream.getTracks().forEach(t => t.enabled = false);
        }
    } catch (e) {}
    setTopStatus('stopped');
    setStatus('stopped');
    enableStartIfReady();
}

///// Input handlers /////

// Microphone toggle
micBtn.addEventListener('click', async () => {
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('getUserMedia not supported');

        // request stream if we don't have it
        if (!micStream) {
            micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
        micStream.getTracks().forEach(t => t.enabled = true);

        await ensureAudioContext();

        // detach existing voice source
        try { if (voiceNode) voiceNode.disconnect(); } catch (e) {}

        voiceNode = audioCtx.createMediaStreamSource(micStream);
        setVoiceActive(true, 'Microphone');
        setVoiceStatus('Microphone active');
        setVoiceFileName('');
        // Connect to analyser if graph exists
        if (analyser) {
            try { voiceNode.connect(analyser); } catch (e) { /* will be reconnected in recreateAudioGraph */ }
        }

        setTopStatus('microphone enabled');
    } catch (err) {
        console.error(err);
        setTopStatus('microphone error');
        setVoiceStatus('Microphone error: ' + (err.message || err));
        setVoiceActive(false, 'No input');
    } finally {
        enableStartIfReady();
    }
});

// Voice file loading
voiceFileInput.addEventListener('change', async (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    const audio = new Audio();
    audio.src = url;
    audio.controls = false;
    audio.loop = true;

    await ensureAudioContext();

    // if context suspended at the moment, do not auto-play (resume on Start)
    if (audioCtx.state !== 'suspended') {
        try { await audio.play(); } catch (e) { /* ignore autoplay errors */ }
    }

    try { if (voiceNode) voiceNode.disconnect(); } catch (e) {}

    voiceNode = audioCtx.createMediaElementSource(audio);
    setVoiceActive(true, 'File');
    setVoiceStatus('Loaded voice file');
    setVoiceFileName(f.name || 'selected audio');
    // connect to analyser if present
    if (analyser) {
        try { voiceNode.connect(analyser); } catch (e) {}
    }

    // if there was a mic stream active, stop it
    try {
        if (micStream) {
            micStream.getTracks().forEach(t => t.stop());
            micStream = null;
        }
    } catch (e) {}

    setTopStatus('voice file loaded');
    enableStartIfReady();
});

// Instrument file loading
instrFileInput.addEventListener('change', async (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    const audio = new Audio();
    audio.src = url;
    audio.controls = false;
    audio.loop = true;

    await ensureAudioContext();

    if (audioCtx.state !== 'suspended') {
        try { await audio.play(); } catch (e) {}
    }

    try { if (instrNode) instrNode.disconnect(); } catch (e) {}

    instrNode = audioCtx.createMediaElementSource(audio);
    setInstrFileName(f.name || 'selected audio');
    instrStatus.textContent = 'Loaded instrument file';
    setInstrActive(true, 'File');
    // when file is selected we automatically switch to file mode
    usingOsc = false;
    updateInstrUI();
    // connect to analyserDelayed if present
    if (analyserDelayed) {
        try { instrNode.connect(analyserDelayed); } catch (e) {}
    }
    setTopStatus('instrument file loaded');
    enableStartIfReady();
});

///// Instrument mode UI (two big visible choices) /////
instrOscBtn.addEventListener('click', () => {
    usingOsc = true;
    updateInstrUI();
    enableStartIfReady();
});
instrFileBtn.addEventListener('click', () => {
    usingOsc = false;
    updateInstrUI();
    enableStartIfReady();
});

function updateInstrUI() {
    instrOscBtn.classList.toggle('active', usingOsc);
    instrFileBtn.classList.toggle('active', !usingOsc);

    // update dot + label
    setInstrActive(true, usingOsc ? 'Oscillator' : 'File');

    // visually dim file section if using osc
    document.getElementById('instrFileSection').classList.toggle('muted', usingOsc);

    // update status text
    if (usingOsc) {
        instrStatus.textContent = 'Using oscillator';
    } else {
        instrStatus.textContent = instrFileName.textContent && instrFileName.textContent !== '—'
            ? 'Using instrument file'
            : 'No instrument file loaded';
    }
}

///// oscillator UI updates /////
oscType.addEventListener('change', () => {
    if (osc) osc.type = oscType.value;
});
oscFreq.addEventListener('input', () => {
    const v = Number(oscFreq.value);
    oscFreqReadout.textContent = v + ' Hz';
    if (osc) osc.frequency.value = v;
});

///// Start/Stop buttons /////
startBtn.addEventListener('click', async () => {
    await ensureAudioContext();

    // check readiness
    const voiceReady = !!voiceNode || !!micStream;
    const instrReady = usingOsc || !!instrNode;
    if (!voiceReady) {
        setTopStatus('please enable microphone or load voice file');
        return;
    }
    if (!instrReady) {
        setTopStatus('please choose oscillator or load instrument file');
        return;
    }

    await recreateAudioGraph();

    if (audioCtx.state === 'suspended') {
        try { await audioCtx.resume(); } catch (e) {}
    }

    // ensure media elements play
    if (voiceNode && voiceNode.mediaElement) {
        try { voiceNode.mediaElement.play(); } catch (e) {}
    }
    if (instrNode && instrNode.mediaElement) {
        try { instrNode.mediaElement.play(); } catch (e) {}
    }

    // start visualizer
    if (!rafId) startVisualizing();

    setTopStatus('running');
    setStatus('running');
    enableStartIfReady();
});

stopBtn.addEventListener('click', async () => {
    await stopAudioGraph();
});

///// Control changes affecting existing nodes /////
fftSelect.addEventListener('change', async () => {
    const fftSize = parseInt(fftSelect.value, 10);
    if (analyser) analyser.fftSize = fftSize;
    if (analyserDelayed) analyserDelayed.fftSize = fftSize;

    // re-create vocoder node to apply new window size
    if (vocoderNode) {
        try {
            analyser?.disconnect();
            analyserDelayed?.disconnect();
            vocoderNode.port.postMessage({ type: "shutdown" });
            vocoderNode.port.close?.();
            vocoderNode.disconnect();
        } catch (e) {}
        vocoderNode = await createVocoderNode();
        analyser?.connect(vocoderNode,0,0);
        analyserDelayed?.connect(vocoderNode,0,1);
        vocoderNode.connect(audioCtx.destination);
    }
});
smoothingEl.addEventListener('input', () => {
    if (analyser) analyser.smoothingTimeConstant = parseFloat(smoothingEl.value);
    if (analyserDelayed) analyserDelayed.smoothingTimeConstant = parseFloat(smoothingEl.value);
});
gainEl.addEventListener('input', () => {
    if (gainNode) gainNode.gain.value = parseFloat(gainEl.value);
});

///// Boot-time friendly behavior /////
document.addEventListener('click', async function _init() {
    document.removeEventListener('click', _init);
    await ensureAudioContext();
    // start suspended so audio won't play until user explicitly starts
    await audioCtx.suspend();
    setTopStatus('idle');
    setStatus('idle');
    setInstrFileName('');
    setVoiceFileName('');
    updateInstrUI();
    enableStartIfReady();
});

// initial canvas fill
resizeCanvas();
