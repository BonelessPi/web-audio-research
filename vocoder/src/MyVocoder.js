// TODO improve naming of Make target, module name, filenames, classnames, etc
// TODO make node class to simplify clean up and allow changing of window size and hop size??
class MyVocoder extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: 'subband', defaultValue: 0, automationRate: 'k-rate' },
        ];
    }

    constructor(options) {
        super();

        // TODO set the number of inputs and outputs correctly

        const wasmModule = options.processorOptions.wasmModule;
        const windowSize = options.processorOptions.windowSize ?? 2048;
        const hopSize = options.processorOptions.hopSize ?? windowSize>>1;
        const melNumBands = options.processorOptions.melNumBands ?? 128;
        const melFreqMin = options.processorOptions.melFreqMin ?? 0;
        const melFreqMax = options.processorOptions.melFreqMax ?? sampleRate>>1;
        console.log({...options.processorOptions});
        this.ready = false;
        this.shouldStop = false;

        this.port.onmessage = (e) => {
            console.log("message recv", e);
            if (e.data.type === "shutdown") {
                // release large buffers, etc.
                console.log("shutdown processor");
                this.exports.vocoder_internal_destroy(this.internalNodePtr);
                this.shouldStop = true;
            }
        };

        const importObject = {
            env: {
                memory: new WebAssembly.Memory({initial: 128}),
                table: new WebAssembly.Table({initial: 0, element: 'anyfunc'}),
                __memory_base: 0,
                __table_base: 0,
                emscripten_notify_memory_growth: () => console.warn("WASM memory growth"),
                abort: msg => { throw new Error(`WASM abort: ${msg}`) },
                segfault: e => { throw new Error(`WASM segfault called: ${e}`); },
                alignfault: e => { throw new Error(`WASM alignfault called: ${e}`); }
            },
            wasi_snapshot_preview1: {
                fd_write: () => console.warn("fd_write stub hit"),
                fd_read: () => console.warn("fd_read stub hit"),
                fd_seek: () => console.warn("fd_seek stub hit"),
                fd_close: () => console.warn("fd_close stub hit"),
                proc_exit: () => console.warn("proc_exit stub hit"),
                environ_get: () => console.warn("environ_get stub hit"),
                environ_sizes_get: () => console.warn("environ_sizes_get stub hit")
            }
        };

        WebAssembly.instantiate(wasmModule, importObject)
        .then(instance => {
            this.instance = instance;
            this.exports = instance.exports;
            this.memory = instance.exports.memory;
            this.internalNodePtr = instance.exports.vocoder_internal_create(
                sampleRate, windowSize, hopSize, melNumBands, melFreqMin, melFreqMax
            );
            this.ready = true;
        });
    }

    process(inputList, outputList, parameters) {
        if(this.shouldStop){
            console.log("process return false");
            return false;
        }
        if(!this.ready){
            return true;
        }

        // This function runs until the audio context is suspended
        // TODO handle multiple channels??
        const voice = inputList[0][0] ?? new Float32Array(128);
        const instr = inputList[1][0] ?? new Float32Array(128);
        const output = outputList[0][0] ?? new Float32Array(128);

        if (voice.length !== 128 || instr.length !== 128){
            throw new Error("Unexpected block size");
        }

        // TODO investigate memory issue when setting output?
        // console.log(this.exports.vocoder_internal_next_voice_quantum_ptr(this.internalNodePtr));
        // console.log(this.exports.vocoder_internal_next_instr_quantum_ptr(this.internalNodePtr));
        // console.log(this.exports.vocoder_internal_next_output_quantum_ptr(this.internalNodePtr));

        new Float32Array(this.memory.buffer,this.exports.vocoder_internal_next_voice_quantum_ptr(this.internalNodePtr),128).set(voice);
        new Float32Array(this.memory.buffer,this.exports.vocoder_internal_next_instr_quantum_ptr(this.internalNodePtr),128).set(instr);
        output.set(new Float32Array(this.memory.buffer,this.exports.vocoder_internal_next_output_quantum_ptr(this.internalNodePtr),128));

        this.exports.vocoder_internal_process(this.internalNodePtr, parameters.subband[0]);

        return true;
    }
}

registerProcessor("my-vocoder", MyVocoder);
