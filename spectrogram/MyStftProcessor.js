// TODO improve naming of Make target, module name, filenames, classnames, etc

class MyStftProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();

        const wasmModule = options.processorOptions.wasmModule;
        this.ready = false;

        const importObject = {
            env: {
                memory: new WebAssembly.Memory({initial: 256}),
                table: new WebAssembly.Table({ initial: 0, element: 'anyfunc' }),
                __memory_base: 0,
                __table_base: 0,
                emscripten_notify_memory_growth: () => console.warn("WASM memory growth"),
                abort: msg => { throw new Error(`WASM abort: ${msg}`) },
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
            this.internalNodePtr = instance.exports.stft_internal_create();
            this.ready = true;
        });
    }

    process(inputList, outputList, parameters) {
        if(!this.ready){
            return true;
        }

        // This function runs until the audio context is suspended
        // TODO handle multiple channels and inputs??
        const input = inputList[0][0] ?? new Float32Array(128);
        const output = outputList[0][0] ?? new Float32Array(128);
        console.log(input)

        // TODO check that write happened
        // TODO write as helper methods here
        new Float32Array(this.memory.buffer,this.exports.stft_internal_next_input_quantum_ptr(this.internalNodePtr),128).set(input);
        output.set(new Float32Array(this.memory.buffer,this.exports.stft_internal_next_output_quantum_ptr(this.internalNodePtr),128));

        // TODO assert same size input and output and quantum len
        this.exports.stft_internal_process(this.internalNodePtr);

        return true;
    }

    destroyInternal(){
        console.warn("DI");
    }
}

registerProcessor("my-stft-processor", MyStftProcessor);
