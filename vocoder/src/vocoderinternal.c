#include "../../kissfft/kiss_fftr.h"
#include <math.h>

#define QUANTUM_SIZE 128
#define MEL_PASSTHROUGH_THRESH .0000001f

// TODO make all snake_case

// Struct for internal operations of the custom AudioWorklet
struct VocoderInternal {
    int sample_rate;
    int window_size;
    int hop_size;
    int mel_num_bands;
    float mel_freq_min;
    float mel_freq_max;
    int index;
    
    void *raw_data;
    float *HANN;
    float *voice_buffer;
    float *instr_buffer;
    float *output_buffer;
    float *time_data;
    float *mel_amps;
    float *mel_bands;
    float *mel_filter;
    kiss_fft_cpx *voice_freq_data;
    kiss_fft_cpx *instr_freq_data;
    kiss_fftr_cfg forward_cfg;
    kiss_fftr_cfg inverse_cfg;
};


// Dynamically alloc an internal struct
struct VocoderInternal* vocoder_internal_create(int sample_rate, int window_size, int hop_size,
    int mel_num_bands, float mel_freq_min, float mel_freq_max) {
    // Check that window_size and hop_size are:
    // - multiples of QUANTUM_SIZE (and window_size is multiple of hop_size)
    // - powers of 2
    // - greater than or equal to QUANTUM_SIZE (and window_size is greater than or equal to hop_size)
    if (window_size%QUANTUM_SIZE != 0 ||
        hop_size%QUANTUM_SIZE != 0 ||
        window_size%hop_size != 0 ||
        (window_size&-window_size) != window_size ||
        (hop_size&-hop_size) != hop_size ||
        window_size < QUANTUM_SIZE ||
        hop_size < QUANTUM_SIZE ||
        window_size < hop_size){
        return NULL;
    }
    
    // Sanitize choices for the mel spectrogram
    if (mel_num_bands <= 0){
        mel_num_bands = 128;
    }
    if (mel_freq_min > mel_freq_max){
        float temp = mel_freq_max;
        mel_freq_max = mel_freq_min;
        mel_freq_min = temp;
    }
    if (mel_freq_min < 0){
        mel_freq_min = 0;
    }
    if (mel_freq_max <= 0 || mel_freq_max > sample_rate/2){
        mel_freq_max = sample_rate/2;
    }
    
    // Malloc struct
    struct VocoderInternal *p = (struct VocoderInternal*)malloc(sizeof(struct VocoderInternal));
    if (!p){
        return NULL;
    }

    // Set simple data in struct
    p->sample_rate = sample_rate;
    p->window_size = window_size;
    p->hop_size = hop_size;
    p->mel_num_bands = mel_num_bands;
    p->mel_freq_min = mel_freq_min;
    p->mel_freq_max = mel_freq_max;
    p->index = 0;
    
    // Calculate size to malloc
    size_t bytes_needed = 5*window_size*sizeof(float) + 2*(window_size/2 + 1)*sizeof(kiss_fft_cpx) + ((window_size/2 + 1) + mel_num_bands + (window_size/2 + 1)*mel_num_bands)*sizeof(float);
    size_t forward_cfg_size = 0, inverse_cfg_size = 0;
    kiss_fftr_alloc(window_size, 0, NULL, &forward_cfg_size);
    kiss_fftr_alloc(window_size, 1, NULL, &inverse_cfg_size);
    bytes_needed += forward_cfg_size + inverse_cfg_size;

    // Malloc the data for the arrays and cfgs
    p->raw_data = malloc(bytes_needed);
    if (!p->raw_data) {
        free(p);
        return NULL;
    }

    // Set the internal pointers of subsections
    p->HANN = (float*)(p->raw_data);
    p->voice_buffer = p->HANN + window_size;
    p->instr_buffer = p->voice_buffer + window_size;
    p->output_buffer = p->instr_buffer + window_size;
    p->time_data = p->output_buffer + window_size;
    p->mel_amps = p->time_data + window_size;
    p->mel_bands = p->mel_amps + window_size/2 + 1;
    p->mel_filter = p->mel_bands + mel_num_bands;
    p->voice_freq_data = (kiss_fft_cpx*)(p->mel_filter + (window_size/2 + 1)*mel_num_bands);
    p->instr_freq_data = p->voice_freq_data + window_size/2 + 1;
    char *cfg_base = (char*)(p->instr_freq_data + window_size/2 + 1);
    p->forward_cfg = (kiss_fftr_cfg)cfg_base;
    p->inverse_cfg = (kiss_fftr_cfg)(cfg_base + forward_cfg_size);

    // Sanity check
    if((void*)(cfg_base+forward_cfg_size+inverse_cfg_size) - p->raw_data != bytes_needed){
        free(p->raw_data);
        free(p);
        return NULL;
    }

    // Precompute Hann window
    for (int i = 0; i < window_size; ++i){
        p->HANN[i] = 0.5 * (1.0 - cos((2.0 * M_PI * i) / window_size));
    }

    // Init voice_buffer, instr_buffer, and output_buffer
    memset(p->voice_buffer, 0, 3*window_size*sizeof(float));

    // TODO set mel_filter
    
    // We can leave time_data, mel_amps, mel_bands, voice_freq_data, and instr_freq_data uninited
    kiss_fftr_alloc(window_size, 0, p->forward_cfg, &forward_cfg_size);
    kiss_fftr_alloc(window_size, 1, p->inverse_cfg, &inverse_cfg_size);

    return p;
}

// Free internal struct
void vocoder_internal_destroy(struct VocoderInternal *p){
    if (!p) return;
    free(p->raw_data);
    free(p);
}

float* vocoder_internal_next_voice_quantum_ptr(struct VocoderInternal *p){
    return p->voice_buffer + p->index;
}

float* vocoder_internal_next_instr_quantum_ptr(struct VocoderInternal *p){
    return p->instr_buffer + p->index;
}

float* vocoder_internal_next_output_quantum_ptr(struct VocoderInternal *p){
    return p->output_buffer + p->index;
}

void vocoder_internal_process(struct VocoderInternal *p) {
    // JS should have done the copy in and out of the buffer views. Advance index
    const int window_size = p->window_size;
    const int hop_size = p->hop_size;
    p->index = (p->index + QUANTUM_SIZE) % window_size;

    if(p->index % hop_size == 0){
        // STFT on voice
        for (int i = 0; i < window_size; ++i){
            p->time_data[i] = p->HANN[i] * p->voice_buffer[(p->index + i) % window_size];
        }
        kiss_fftr(p->forward_cfg, p->time_data, p->voice_freq_data);
        
        // STFT on instr
        for (int i = 0; i < window_size; ++i){
            p->time_data[i] = p->HANN[i] * p->instr_buffer[(p->index + i) % window_size];
        }
        kiss_fftr(p->forward_cfg, p->time_data, p->instr_freq_data);
        
        // TODO sub-band
        for (int i = 0; i < window_size/2+1; ++i){
            p->mel_amps[i] = sqrtf(p->voice_freq_data[i].r*p->voice_freq_data[i].r + p->voice_freq_data[i].i*p->voice_freq_data[i].i);
        }

        _apply_mel_filter(p);

        for (int i = 0; i < window_size/2+1; ++i){
            float amp = p->mel_amps[i];
            if (amp < MEL_PASSTHROUGH_THRESH){
                amp = 1.0f;
            }
            p->instr_freq_data[i].r *= amp;
            p->instr_freq_data[i].i *= amp;
        }
        kiss_fftri(p->inverse_cfg, p->instr_freq_data, p->time_data);

        // SOLA: Update output_buffer from time_data (clear new part and append to current area)
        for (int i = 0; i < hop_size; ++i){
            p->output_buffer[(p->index + window_size - hop_size + i) % window_size] = 0.0f;
        }
        for (int i = 0; i < window_size; ++i){
            p->output_buffer[(p->index + i) % window_size] += (2.0f/(window_size/hop_size)) * p->time_data[i] / window_size;
        }
    }
}

void _create_mel_filter(struct VocoderInternal *p){
    // TODO implement
    // TODO potentially remove from struct and do calc on the fly (sparse matrix)
}

void _apply_mel_filter(struct VocoderInternal *p){
    const int M = p->mel_num_bands;
    const int N = p->window_size/2 + 1;
    // Multiply by Mel filter
    for (int r = 0; r < M; ++r){
        float temp = 0;
        for (int c = 0; r < N; ++c){
            temp += p->mel_filter[r*N + c] * p->mel_amps[c];
        }
        p->mel_bands[r] = temp;
    }
    // Multiply by Mel filter transpose
    memset(p->mel_amps,0,N*sizeof(float));
    for (int i = 0; i < M*N; ++i){
        p->mel_amps[i%N] += p->mel_filter[i] * p->mel_bands[i/N];
    }
}

float freq_to_mel(float freq){
    return 1127.0f * log1pf(freq / 700.0f);
}

float mel_to_freq(float mel){
    return 700.0f * expm1f(m / 1127.0f)
}
