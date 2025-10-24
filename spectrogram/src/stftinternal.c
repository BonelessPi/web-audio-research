#include "../../kissfft/kiss_fftr.h"
#include <math.h>

#define QUANTUM_SIZE 128

// Struct for internal operations of the custom AudioWorklet
struct StftInternal {
    int windowSize;
    int hopSize;
    int index;

    void *rawData;
    float *HANN;
    float *inputBuffer;
    float *outputBuffer;
    float *timeData;
    kiss_fft_cpx *freqData;
    kiss_fftr_cfg forward_cfg;
    kiss_fftr_cfg inverse_cfg;
};


// Dynamically alloc an internal struct
struct StftInternal* stft_internal_create(int windowSize, int hopSize) {
    // Check that windowSize and hopSize are multiples of QUANTUM_SIZE and windowSize is multiple of hopSize
    // Check that windowSize and hopSize are powers of 2
    // Check that windowSize and hopSize are greater than or equal to QUANTUM_SIZE and windowSize is greater than or equal to hopSize
    if (windowSize%QUANTUM_SIZE != 0 ||
        hopSize%QUANTUM_SIZE != 0 ||
        windowSize%hopSize != 0 ||
        (windowSize&-windowSize) != windowSize ||
        (hopSize&-hopSize) != hopSize ||
        windowSize < QUANTUM_SIZE ||
        hopSize < QUANTUM_SIZE ||
        windowSize < hopSize){
        return NULL;
    }
    
    // Malloc struct
    struct StftInternal *p = (struct StftInternal*)malloc(sizeof(struct StftInternal));
    if (!p){
        return NULL;
    }

    // Set simple data in struct
    p->windowSize = windowSize;
    p->hopSize = hopSize;
    p->index = 0;
    
    // Calculate size to malloc
    size_t bytes_needed = (4*windowSize*sizeof(float) + (windowSize/2 + 1)*sizeof(kiss_fft_cpx)), forward_cfg_size = 0, inverse_cfg_size = 0;
    kiss_fftr_alloc(windowSize, 0, NULL, &forward_cfg_size);
    kiss_fftr_alloc(windowSize, 1, NULL, &inverse_cfg_size);
    bytes_needed += forward_cfg_size + inverse_cfg_size;

    // Malloc the data for the arrays and cfgs
    p->rawData = malloc(bytes_needed);
    if (!p->rawData) {
        free(p);
        return NULL;
    }

    // Set the internal pointers of subsections
    p->HANN = (float*)(p->rawData);
    p->inputBuffer = p->HANN + windowSize;
    p->outputBuffer = p->inputBuffer + windowSize;
    p->timeData = p->outputBuffer + windowSize;
    p->freqData = (kiss_fft_cpx*)(p->timeData + windowSize);
    char *cfg_base = (char*)(p->freqData + windowSize/2 + 1);
    p->forward_cfg = (kiss_fftr_cfg)cfg_base;
    p->inverse_cfg = (kiss_fftr_cfg)(cfg_base + forward_cfg_size);

    // Precompute Hann window
    for (int i = 0; i < windowSize; ++i){
        p->HANN[i] = 0.5 * (1.0 - cos((2.0 * M_PI * i) / windowSize));
    }
    memset(p->inputBuffer, 0, 2*windowSize*sizeof(float));
    // outputBuffer is also set in prior line
    // We can leave timeData and freqData uninited
    kiss_fftr_alloc(windowSize, 0, p->forward_cfg, &forward_cfg_size);
    kiss_fftr_alloc(windowSize, 1, p->inverse_cfg, &inverse_cfg_size);

    return p;
}

// Free internal struct
void stft_internal_destroy(struct StftInternal *p){
    if (!p) return;
    free(p->rawData);
    free(p);
}

float* stft_internal_next_input_quantum_ptr(struct StftInternal *p){
    return p->inputBuffer + p->index;
}

float* stft_internal_next_output_quantum_ptr(struct StftInternal *p){
    return p->outputBuffer + p->index;
}

void stft_internal_process(struct StftInternal *p) {
    // JS should have done the copy in and out of the buffer views. Advance index
    const int windowSize = p->windowSize;
    const int hopSize = p->hopSize;
    p->index = (p->index + QUANTUM_SIZE) % windowSize;

    // SOLA: Update outputBuffer (clear new part and append to current area)
    if(p->index % hopSize == 0){
        for (int i = 0; i < windowSize; ++i){
            p->timeData[i] = p->HANN[i] * p->inputBuffer[(p->index + i) % windowSize];
        }

        kiss_fftr(p->forward_cfg, p->timeData, p->freqData);
        for (int i = 0; i < windowSize/2+1; ++i){
            p->freqData[i].r *= i<windowSize/8;
            p->freqData[i].i *= i<windowSize/8;
        }
        kiss_fftri(p->inverse_cfg, p->freqData, p->timeData);

        for (int i = 0; i < hopSize; ++i){
            p->outputBuffer[(p->index + windowSize - hopSize + i) % windowSize] = 0.0f;
        }
        for (int i = 0; i < windowSize; ++i){
            p->outputBuffer[(p->index + i) % windowSize] += (2.0f/(windowSize/hopSize)) * p->timeData[i] / windowSize;
        }
    }
}
