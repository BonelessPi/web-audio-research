// TODO improve naming of Make target, module name, filenames, classnames, etc

class MyStftProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();

        const wasmModule = options.processorOptions.wasmModule;
        console.log(wasmModule);
        this.ready = false;

        WebAssembly.instantiate(wasmModule, { env: {} })
        .then(instance => {
            this.instance = instance;
            this.exports = instance.exports;
            this.memory = instance.exports.memory;
            this.internalNodePtr = instance.exports._stft_internal_create();
            this.ready = true;
        });
    }

    process(inputList, outputList, parameters) {
        // TODO handle multiple channels and inputs??
        const input = inputList[0][0];
        const output = outputList[0][0];

        // TODO check that write happened
        // TODO write as helper methods here
        new Float32Array(this.instance.HEAPF32.buffer,this.exports._stft_internal_next_input_quantum_ptr(this.internalNodePtr),128).set(input);
        output.set(new Float32Array(this.instance.HEAPF32.buffer,this.exports._stft_internal_next_output_quantum_ptr(this.internalNodePtr),128));

        // TODO assert same size input and output and quantum len
        this.internalNode.process();

        return true;
    }
}

registerProcessor("my-stft-processor", MyStftProcessor);
