// TODO improve naming of Make target, module name, filenames, classnames, etc
// TODO make node class to simplify clean up and allow changing of window size and hop size??
class MyStftProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();

        const wasmModule = options.processorOptions.wasmModule;
        const windowSize = options.processorOptions.windowSize;
        const hopSize = options.processorOptions.hopSize;
        console.log({windowSize, hopSize});
        this.ready = false;
        this.shouldStop = false;

        this.port.onmessage = (e) => {
            console.log("message recv", e);
            if (e.data.type === "shutdown") {
                // release large buffers, etc.
                console.log("shutdown processor");
                this.exports.stft_internal_destroy(this.internalNodePtr);
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
            this.internalNodePtr = instance.exports.stft_internal_create(windowSize,hopSize);
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
        // TODO handle multiple channels and inputs??
        const input = inputList[0][0] ?? new Float32Array(128);
        const output = outputList[0][0] ?? new Float32Array(128);
        // console.log(input)
        if (input.length !== 128){
            throw new Error("Unexpected block size");
        }

        new Float32Array(this.memory.buffer,this.exports.stft_internal_next_input_quantum_ptr(this.internalNodePtr),128).set(input);
        output.set(new Float32Array(this.memory.buffer,this.exports.stft_internal_next_output_quantum_ptr(this.internalNodePtr),128));

        this.exports.stft_internal_process(this.internalNodePtr);

        return true;
    }
}

registerProcessor("my-stft-processor", MyStftProcessor);
