#include "../../kissfft/kiss_fftr.h"
#include <math.h>

#define QUANTUM_SIZE 128

// Struct for internal operations of the custom AudioWorklet
struct VocoderInternal {
    int windowSize;
    int hopSize;
    int index;

    void *rawData;
    float *HANN;
    float *voiceBuffer;
    float *instrBuffer;
    float *outputBuffer;
    float *timeData;
    kiss_fft_cpx *voiceFreqData;
    kiss_fft_cpx *instrFreqData;
    kiss_fftr_cfg forward_cfg;
    kiss_fftr_cfg inverse_cfg;
};


// Dynamically alloc an internal struct
struct VocoderInternal* vocoder_internal_create(int windowSize, int hopSize) {
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
    struct VocoderInternal *p = (struct VocoderInternal*)malloc(sizeof(struct VocoderInternal));
    if (!p){
        return NULL;
    }

    // Set simple data in struct
    p->windowSize = windowSize;
    p->hopSize = hopSize;
    p->index = 0;
    
    // Calculate size to malloc
    size_t bytes_needed = (5*windowSize*sizeof(float) + 2*(windowSize/2 + 1)*sizeof(kiss_fft_cpx)), forward_cfg_size = 0, inverse_cfg_size = 0;
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
    p->voiceBuffer = p->HANN + windowSize;
    p->instrBuffer = p->voiceBuffer + windowSize;
    p->outputBuffer = p->instrBuffer + windowSize;
    p->timeData = p->outputBuffer + windowSize;
    p->voiceFreqData = (kiss_fft_cpx*)(p->timeData + windowSize);
    p->instrFreqData = p->voiceFreqData + windowSize/2 + 1;
    char *cfg_base = (char*)(p->instrFreqData + windowSize/2 + 1);
    p->forward_cfg = (kiss_fftr_cfg)cfg_base;
    p->inverse_cfg = (kiss_fftr_cfg)(cfg_base + forward_cfg_size);

    // Sanity check
    if((void*)(cfg_base+forward_cfg_size+inverse_cfg_size) - p->rawData != bytes_needed){
        free(p->rawData);
        free(p);
        return NULL;
    }

    // Precompute Hann window
    for (int i = 0; i < windowSize; ++i){
        p->HANN[i] = 0.5 * (1.0 - cos((2.0 * M_PI * i) / windowSize));
    }

    // Init voiceBuffer, instrBuffer, and outputBuffer
    memset(p->voiceBuffer, 0, 3*windowSize*sizeof(float));
    
    // We can leave timeData, voiceFreqData, and instrFreqData uninited
    kiss_fftr_alloc(windowSize, 0, p->forward_cfg, &forward_cfg_size);
    kiss_fftr_alloc(windowSize, 1, p->inverse_cfg, &inverse_cfg_size);

    return p;
}

// Free internal struct
void vocoder_internal_destroy(struct VocoderInternal *p){
    if (!p) return;
    free(p->rawData);
    free(p);
}

float* vocoder_internal_next_voice_quantum_ptr(struct VocoderInternal *p){
    return p->voiceBuffer + p->index;
}

float* vocoder_internal_next_instr_quantum_ptr(struct VocoderInternal *p){
    return p->instrBuffer + p->index;
}

float* vocoder_internal_next_output_quantum_ptr(struct VocoderInternal *p){
    return p->outputBuffer + p->index;
}

void vocoder_internal_process(struct VocoderInternal *p) {
    // JS should have done the copy in and out of the buffer views. Advance index
    const int windowSize = p->windowSize;
    const int hopSize = p->hopSize;
    p->index = (p->index + QUANTUM_SIZE) % windowSize;

    if(p->index % hopSize == 0){
        // STFT on voice
        for (int i = 0; i < windowSize; ++i){
            p->timeData[i] = p->HANN[i] * p->voiceBuffer[(p->index + i) % windowSize];
        }
        kiss_fftr(p->forward_cfg, p->timeData, p->voiceFreqData);
        
        // STFT on instr
        for (int i = 0; i < windowSize; ++i){
            p->timeData[i] = p->HANN[i] * p->instrBuffer[(p->index + i) % windowSize];
        }
        kiss_fftr(p->forward_cfg, p->timeData, p->instrFreqData);
        
        // TODO sub-band

        for (int i = 0; i < windowSize/2+1; ++i){
            float amp = sqrtf(p->voiceFreqData[i].r*p->voiceFreqData[i].r + p->voiceFreqData[i].i*p->voiceFreqData[i].i);
            p->instrFreqData[i].r *= amp;
            p->instrFreqData[i].i *= amp;
        }
        kiss_fftri(p->inverse_cfg, p->instrFreqData, p->timeData);

        // SOLA: Update outputBuffer from timeData (clear new part and append to current area)
        for (int i = 0; i < hopSize; ++i){
            p->outputBuffer[(p->index + windowSize - hopSize + i) % windowSize] = 0.0f;
        }
        for (int i = 0; i < windowSize; ++i){
            p->outputBuffer[(p->index + i) % windowSize] += (2.0f/(windowSize/hopSize)) * p->timeData[i] / windowSize;
        }
    }
}
