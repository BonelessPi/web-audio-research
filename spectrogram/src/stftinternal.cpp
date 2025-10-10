#include "../../kissfft/kiss_fftr.h"
#include <emscripten/val.h>
#include <cstring>

// TODO: make these specifiable in constructor?
// TODO: assert Q|H|W (divides)
#define BUFFER_SIZE (WINDOW_SIZE*2)
#define WINDOW_SIZE (QUANTUM_SIZE*8)
#define HOP_SIZE (QUANTUM_SIZE*4)
#define QUANTUM_SIZE 128

/*
enum class FftDirection {
    Direct,
    Inverse
};

struct KissFftBase {
    KissFftBase(size_t size, FftDirection direction) {
        state = kiss_fftr_alloc(size, direction == FftDirection::Direct ? 0 : 1, nullptr, nullptr);
    }
    ~KissFftBase() {
        kiss_fft_free(state);
    }

    kiss_fftr_state *state;
};

struct KissFftReal : KissFftBase {
    KissFftReal(size_t size) : KissFftBase{ size, FftDirection::Direct } {
        input.resize(size);
        output.resize(size + 2);
    }

    auto transform() const {
        kiss_fftr(state, input.data(), reinterpret_cast<kiss_fft_cpx *>(output.data()));

        return emscripten::val{ emscripten::typed_memory_view(output.size(), output.data()) };
    }

    auto getInputTimeDataBuffer() {
        return emscripten::val{ emscripten::typed_memory_view(input.size(), input.data()) };
    }

private:
    std::vector<double> input;
    mutable std::vector<double> output;
};

struct KissFftRealInverse : KissFftBase {
    private:
        std::vector<double> input;
        mutable std::vector<double> output;

    public:
        KissFftRealInverse(size_t size) : KissFftBase{ size, FftDirection::Inverse } {
            input.resize(size + 2);
            output.resize(size);
        }

        auto transform() const {
            kiss_fftri(state, reinterpret_cast<const kiss_fft_cpx *>(input.data()), output.data());

            return emscripten::val{ emscripten::typed_memory_view(output.size(), output.data()) };
        }

        auto getInputFrequencyDataBuffer() {
            return emscripten::val{ emscripten::typed_memory_view(input.size(), input.data()) };
        }
};

EMSCRIPTEN_BINDINGS(KissFft) {
    emscripten::class_<KissFftReal>("KissFftReal")
        .constructor<size_t>()
        .function("getInputTimeDataBuffer", &KissFftReal::getInputTimeDataBuffer)
        .function("transform", &KissFftReal::transform)
        ;

    emscripten::class_<KissFftRealInverse>("KissFftRealInverse")
        .constructor<size_t>()
        .function("getInputFrequencyDataBuffer", &KissFftRealInverse::getInputFrequencyDataBuffer)
        .function("transform", &KissFftRealInverse::transform)
        ;
}
*/

// TODO make struct?
class StftInternal{
public:
    float inputBuffer[BUFFER_SIZE] = {};
    float outputBuffer[BUFFER_SIZE] = {};
    int inputIdx = WINDOW_SIZE-HOP_SIZE;
    int outputIdx = 0;
};

extern "C" {

StftInternal* stft_internal_create(){
    StftInternal *p = new StftInternal();
    return p;
}

void stft_internal_destroy(StftInternal *p){
    delete p;
}

//TODO assert in bounds?
float* stft_internal_next_input_quantum_ptr(StftInternal *p){
    return p->inputBuffer + p->inputIdx;
}

float* stft_internal_next_output_quantum_ptr(StftInternal *p){
    return p->outputBuffer + p->outputIdx;
}

void stft_internal_process(StftInternal *p) {
    // JS should have done the copy in and out of the buffer views. Advance idxs
    p->inputIdx += QUANTUM_SIZE;
    p->outputIdx += QUANTUM_SIZE;

    // SOLA section: Update outputBuffer (clear new part and append to current area)
    if(p->inputIdx % HOP_SIZE == 0){
        // TODO FFT + filter (on the prior window len samples)
        // POC
        for (size_t i = 0; i < HOP_SIZE; i++){
            p->outputBuffer[(p->outputIdx+i)%BUFFER_SIZE] = p->inputBuffer[p->inputIdx-WINDOW_SIZE+i];
        }
        
        // for (size_t i = 0; i < HOP_SIZE; i++){
        //     outputBuffer[(outputIdx+WINDOW_SIZE-HOP_SIZE+i)%BUFFER_SIZE] = 0.0;
        // }
        // for(size_t i = 0; i < WINDOW_SIZE; i++){
        //     // TODO test if outputbuffer memmove is faster
        //     outputBuffer[(outputIdx+i)%BUFFER_SIZE] += inputBuffer[inputIdx-WINDOW_SIZE+i];
        // }
    }

    if(p->outputIdx >= BUFFER_SIZE){
        p->outputIdx -= BUFFER_SIZE;
    }
    
    if(p->inputIdx >= BUFFER_SIZE){
        memcpy(p->inputBuffer,p->inputBuffer+(BUFFER_SIZE-WINDOW_SIZE+HOP_SIZE),sizeof(float)*(WINDOW_SIZE-HOP_SIZE));
        p->inputIdx = WINDOW_SIZE-HOP_SIZE;
    }
}

} // extern C