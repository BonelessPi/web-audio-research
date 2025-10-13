#include "../../kissfft/kiss_fftr.h"
#include <math.h>

// TODO: assert Q|H|W (divides)
#define QUANTUM_SIZE 128
#define HOP_SIZE (QUANTUM_SIZE*4)
#define WINDOW_SIZE (QUANTUM_SIZE*8)

// Struct for internal operations of the custom AudioWorklet
struct StftInternal {
    float inputBuffer[WINDOW_SIZE];
    float outputBuffer[WINDOW_SIZE];
    float timeData[WINDOW_SIZE];
    kiss_fft_cpx freqData[WINDOW_SIZE / 2 + 1];
    float HANN[WINDOW_SIZE];
    kiss_fftr_cfg forward_cfg;
    kiss_fftr_cfg inverse_cfg;
    int index;
};

// TODO make fft_size a parameter
// Dynamically alloc an internal struct
struct StftInternal* stft_internal_create(void) {
    // Malloc struct
    struct StftInternal *p = (struct StftInternal*)malloc(sizeof(struct StftInternal));
    if (!p){
        return NULL;
    }
    // Set data in struct (especially the arrays)
    memset(p, 0, sizeof(*p));

    // Alloc kiss fftr cfg
    p->forward_cfg = kiss_fftr_alloc(WINDOW_SIZE, 0, NULL, NULL);
    p->inverse_cfg = kiss_fftr_alloc(WINDOW_SIZE, 1, NULL, NULL);

    if (!p->forward_cfg || !p->inverse_cfg) {
        free(p->forward_cfg);
        free(p->inverse_cfg);
        free(p);
        return NULL;
    }

    // Precompute Hann window
    for (int i = 0; i < WINDOW_SIZE; ++i){
        p->HANN[i] = 0.5 * (1.0 - cos((2.0 * M_PI * i) / WINDOW_SIZE));
    }

    // Index for input and output buffers
    p->index = 0;

    return p;
}

// Free internal struct
void stft_internal_destroy(struct StftInternal *p){
    if (!p) return;
    free(p->forward_cfg);
    free(p->inverse_cfg);
    free(p);
}

// TODO assert in bounds?
float* stft_internal_next_input_quantum_ptr(struct StftInternal *p){
    return p->inputBuffer + p->index;
}

float* stft_internal_next_output_quantum_ptr(struct StftInternal *p){
    return p->outputBuffer + p->index;
}

void stft_internal_process(struct StftInternal *p) {
    // JS should have done the copy in and out of the buffer views. Advance index
    p->index = (p->index + QUANTUM_SIZE) % WINDOW_SIZE;

    // SOLA: Update outputBuffer (clear new part and append to current area)
    if(p->index % HOP_SIZE == 0){
        for (int i = 0; i < WINDOW_SIZE; ++i){
            p->timeData[i] = p->HANN[i] * p->inputBuffer[(p->index+i)%WINDOW_SIZE];
        }

        kiss_fftr(p->forward_cfg, p->timeData, p->freqData);
        // TODO filter
        kiss_fftri(p->inverse_cfg, p->freqData, p->timeData);

        for (int i = 0; i < HOP_SIZE; ++i){
            p->outputBuffer[(p->index+WINDOW_SIZE-HOP_SIZE+i)%WINDOW_SIZE] = 0.0f;
        }
        for (int i = 0; i < WINDOW_SIZE; ++i){
            p->outputBuffer[(p->index+i)%WINDOW_SIZE] += (2.0f/(WINDOW_SIZE/HOP_SIZE)) * p->timeData[i] / WINDOW_SIZE;
        }
    }
}
