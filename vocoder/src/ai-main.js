// main.js — refactored and updated

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

// instrOscNode controls
const oscType = document.getElementById('oscType');
const oscFreq = document.getElementById('oscFreq');
const oscFreqReadout = document.getElementById('oscFreqReadout');

// general controls
const subbandBtn = document.getElementById('subbandBtn')
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const fftSelect = document.getElementById('fftSize');
const smoothingEl = document.getElementById('smoothing');
const gainEl = document.getElementById('gain');

// canvas helpers
const marginLeft = 0;
const ctx = canvas.getContext('2d');

///// Audio graph state /////
let audioCtx = null;

let micStream = null;
let voiceNode = null;
let voiceGainNode = null;

let instrFileNode = null;
let instrFileGainNode = null;
let instrOscNode = null;
let instrOscGainNode = null;

let analyserVoice = null;
let analyserInstr = null;
let analyserOutput = null;
let vocoderNode = null;

let rafId = null;

// UI state
let usingOsc = true;

let subband = true;

///// Canvas setup /////
function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * devicePixelRatio);
    canvas.height = Math.floor(rect.height * devicePixelRatio);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}
window.addEventListener('resize', resizeCanvas);

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
    // simple readiness: a voice source exists (mic or file) AND (instr: either instrOscNode selected OR file loaded)
    const voiceReady = !!voiceNode || !!micStream;
    const instrReady = usingOsc ? !!instrOscNode : !!instrFileNode;
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
            hopSize: windowSize >> 1,
            melNumBands: 128,
            melFreqMin: 0,
            melFreqMax: 4000
        }
    });
}

// draw a single vertical column for the frequency array into the canvas at the rightmost column,
// mapping it to the vertical slice yStart..yEnd
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

// Visualizer loop now handles three analysers and three bands stacked vertically.
// Top band: voice (analyserVoice), middle band: instr (analyserInstr), bottom band: output (analyserOutput)
async function startVisualizing() {
    if (!analyserVoice) analyserVoice = await createAnalyser();
    if (!analyserInstr) analyserInstr = await createAnalyser();
    if (!analyserOutput) analyserOutput = await createAnalyser();

    const binsV = analyserVoice.frequencyBinCount;
    const binsI = analyserInstr.frequencyBinCount;
    const binsO = analyserOutput.frequencyBinCount;

    const dataV = new Uint8Array(binsV);
    const dataI = new Uint8Array(binsI);
    const dataO = new Uint8Array(binsO);

    function loop() {
        // fill arrays
        analyserVoice.getByteFrequencyData(dataV);
        analyserInstr.getByteFrequencyData(dataI);
        analyserOutput.getByteFrequencyData(dataO);

        // compute band heights (split canvas into 3 horizontal bands)
        const h = canvas.height;
        const bandH = Math.floor(h / 3);
        const band1Start = 0;
        const band1End = band1Start + bandH;
        const band2Start = band1End;
        const band2End = band2Start + bandH;
        const band3Start = band2End;
        const band3End = h;

        // shift existing plot left by 1 pixel for the plotting region (exclude marginLeft)
        const plotW = canvas.width - marginLeft;
        // copy the content one pixel left within plotting area
        ctx.drawImage(canvas, marginLeft + 1, 0, plotW - 1, h, marginLeft, 0, plotW - 1, h);

        // Draw rightmost column for each band
        drawSpectrogramColumn(dataV, band1Start, band1End); // voice top
        drawSpectrogramColumn(dataI, band2Start, band2End); // instr middle
        drawSpectrogramColumn(dataO, band3Start, band3End); // output bottom

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
async function createAudioGraph() {
    await ensureAudioContext();

    voiceNode = audioCtx.createBufferSource();
    voiceNode.buffer = audioCtx.createBuffer(1, 1, audioCtx.sampleRate);
    voiceNode.start(0);

    voiceGainNode = audioCtx.createGain();
    voiceGainNode.gain.value = parseFloat(gainEl.value);
    instrOscNode = audioCtx.createOscillator();
    instrOscNode.type = oscType.value;
    instrOscNode.frequency.value = Number(oscFreq.value);
    instrOscNode.start();
    instrOscGainNode = audioCtx.createGain();
    instrOscGainNode.gain.value = 0.0;
    instrFileGainNode = audioCtx.createGain();
    instrFileGainNode.gain.value = 0.0;

    vocoderNode = await createVocoderNode();

    analyserVoice = await createAnalyser();
    analyserInstr = await createAnalyser();
    analyserOutput = await createAnalyser();

    // Voice -> gain -> analyser -> vocoder input 0
    voiceNode.connect(voiceGainNode);
    voiceGainNode.connect(analyserVoice);
    analyserVoice.connect(vocoderNode, 0, 0);

    // Instrument -> analyser -> vocoder input 1
    instrOscNode.connect(instrOscGainNode);
    instrOscGainNode.connect(analyserInstr);
    instrFileGainNode.connect(analyserInstr);
    analyserInstr.connect(vocoderNode, 0, 1);

    vocoderNode.connect(analyserOutput);
    analyserOutput.connect(audioCtx.destination);
}

async function stopAudioGraph() {
    if (!audioCtx) return;
    try { await audioCtx.suspend(); } catch (e) {}
    stopVisualizing();

    // pause media elements if any
    if (voiceNode && voiceNode.mediaElement) {
        try { voiceNode.mediaElement.pause(); } catch (e) {}
    }
    if (instrFileNode && instrFileNode.mediaElement) {
        try { instrFileNode.mediaElement.pause(); } catch (e) {}
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

        if (voiceGainNode) {
            try { voiceNode.connect(voiceGainNode); } catch (e) { /* will be reconnected in recreateAudioGraph */ }
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

    if (voiceGainNode) {
        try { voiceNode.connect(voiceGainNode); } catch (e) {}
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

    try { if (instrFileNode) instrFileNode.disconnect(); } catch (e) {}

    instrFileNode = audioCtx.createMediaElementSource(audio);
    setInstrFileName(f.name || 'selected audio');
    instrStatus.textContent = 'Loaded instrument file';
    setInstrActive(true, 'File');
    // when file is selected we automatically switch to file mode
    usingOsc = false;
    updateInstrUI();
    
    if (instrFileGainNode) {
        try { instrFileNode.connect(instrFileGainNode); } catch (e) {}
    }
    setTopStatus('instrument file loaded');
    enableStartIfReady();
});

///// Instrument mode UI (two big visible choices) /////
instrOscBtn.addEventListener('click', () => {
    instrOscGainNode.gain.value = 1.0;
    instrFileGainNode.gain.value = 0.0;
    usingOsc = true;
    updateInstrUI();
    enableStartIfReady();
});
instrFileBtn.addEventListener('click', () => {
    instrOscGainNode.gain.value = 0.0;
    instrFileGainNode.gain.value = 1.0;
    usingOsc = false;
    updateInstrUI();
    enableStartIfReady();
});

subbandBtn.addEventListener('click', () => {
    subband = !subband;
    if (vocoderNode){
        vocoderNode.parameters.get('subband').value = subband;
    }
});

function updateInstrUI() {
    instrOscBtn.classList.toggle('active', usingOsc);
    instrFileBtn.classList.toggle('active', !usingOsc);

    // update dot + label
    setInstrActive(true, usingOsc ? 'Oscillator' : 'File');

    // visually dim file section if using instrOscNode
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
    if (instrOscNode) instrOscNode.type = oscType.value;
});
oscFreq.addEventListener('input', () => {
    const v = Number(oscFreq.value);
    oscFreqReadout.textContent = v + ' Hz';
    if (instrOscNode) instrOscNode.frequency.value = v;
});

///// Start/Stop buttons /////
startBtn.addEventListener('click', async () => {
    await ensureAudioContext();

    // check readiness
    const voiceReady = !!voiceNode || !!micStream;
    const instrReady = usingOsc ? !!instrOscNode : !!instrFileNode;
    if (!voiceReady) {
        setTopStatus('please enable microphone or load voice file');
        return;
    }
    if (!instrReady) {
        setTopStatus('please choose oscillator or load instrument file');
        return;
    }

    if (audioCtx.state === 'suspended') {
        try { await audioCtx.resume(); } catch (e) {}
    }

    // ensure media elements play
    if (voiceNode && voiceNode.mediaElement) {
        try { voiceNode.mediaElement.play(); } catch (e) {}
    }
    if (instrFileNode && instrFileNode.mediaElement) {
        try { instrFileNode.mediaElement.play(); } catch (e) {}
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
    if (analyserVoice) analyserVoice.fftSize = fftSize;
    if (analyserInstr) analyserInstr.fftSize = fftSize;
    if (analyserOutput) analyserOutput.fftSize = fftSize;

    // re-create vocoder node to apply new window size
    if (vocoderNode) {
        try {
            analyserVoice?.disconnect();
            analyserInstr?.disconnect();
            vocoderNode.port.postMessage({ type: "shutdown" });
            vocoderNode.port.close?.();
            vocoderNode.disconnect();
        } catch (e) {}
        vocoderNode = await createVocoderNode();
        analyserVoice?.connect(vocoderNode,0,0);
        analyserInstr?.connect(vocoderNode,0,1);
        vocoderNode.connect(analyserOutput);
    }
});
smoothingEl.addEventListener('input', () => {
    if (analyserVoice) analyserVoice.smoothingTimeConstant = parseFloat(smoothingEl.value);
    if (analyserInstr) analyserInstr.smoothingTimeConstant = parseFloat(smoothingEl.value);
    if (analyserOutput) analyserOutput.smoothingTimeConstant = parseFloat(smoothingEl.value);
});
gainEl.addEventListener('input', () => {
    if (voiceGainNode) voiceGainNode.gain.value = parseFloat(gainEl.value);
});

///// Boot-time friendly behavior /////
document.addEventListener('click', async function _init() {
    document.removeEventListener('click', _init);
    await ensureAudioContext();
    // start suspended so audio won't play until user explicitly starts
    await audioCtx.suspend();
    createAudioGraph();
    setTopStatus('idle');
    setStatus('idle');
    setInstrFileName('');
    setVoiceFileName('');
    updateInstrUI();
    enableStartIfReady();
});

// initial canvas fill
resizeCanvas();
