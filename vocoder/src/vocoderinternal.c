#include "../../kissfft/kiss_fftr.h"
#include <math.h>

#define QUANTUM_SIZE 128

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
    int *MEL_BIN;
    kiss_fft_cpx *voice_freq_data;
    kiss_fft_cpx *instr_freq_data;
    kiss_fftr_cfg forward_cfg;
    kiss_fftr_cfg inverse_cfg;
};

void _apply_mel_filter(struct VocoderInternal *p);


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
        const float temp = mel_freq_max;
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
    size_t bytes_needed = 5*window_size*sizeof(float) + 2*(window_size/2 + 1)*sizeof(kiss_fft_cpx) + ((window_size/2 + 1) + mel_num_bands)*sizeof(float) + (mel_num_bands+2)*sizeof(int);
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
    p->MEL_BIN = (int*)(p->mel_bands + mel_num_bands);
    p->voice_freq_data = (kiss_fft_cpx*)(p->MEL_BIN + mel_num_bands+2);
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

    // Create MEL_BIN
    const float mel_min_m = 1127.0f * log1pf(mel_freq_min / 700.0f);
    const float mel_max_m = 1127.0f * log1pf(mel_freq_max / 700.0f);
    const float mel_step  = (mel_max_m - mel_min_m) / (mel_num_bands + 1);
    for (int i = 0; i < p->mel_num_bands + 2; ++i) {
        float mel = mel_min_m + i*mel_step;
        float freq = 700.0f * expm1f(mel / 1127.0f);
        float bin_f = freq * ((float)window_size/(float)sample_rate);

        if (bin_f < 0.0f){
            bin_f = 0.0f;
        }
        if (bin_f > window_size/2){
            bin_f = (float)(window_size/2);
        }

        p->MEL_BIN[i] = (int)(bin_f + 0.5f);
    }

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

void vocoder_internal_process(struct VocoderInternal *p, int flags) {
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
        
        for (int i = 0; i < window_size/2+1; ++i){
            p->mel_amps[i] = sqrtf(p->voice_freq_data[i].r*p->voice_freq_data[i].r + p->voice_freq_data[i].i*p->voice_freq_data[i].i);
        }
        if (flags & 1){
            _apply_mel_filter(p);
        }
        
        for (int i = 0; i < window_size/2+1; ++i){
            p->instr_freq_data[i].r *= p->mel_amps[i];
            p->instr_freq_data[i].i *= p->mel_amps[i];
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

inline float _calc_mel_filter_val(struct VocoderInternal *p, int r, int c){
    if (c > p->MEL_BIN[r] && c < p->MEL_BIN[r+1]){
        return (float)(c - p->MEL_BIN[r])/(p->MEL_BIN[r+1] - p->MEL_BIN[r]);
    }
    if (c > p->MEL_BIN[r+1] && c < p->MEL_BIN[r+2]){
        return (float)(p->MEL_BIN[r+2] - c)/(p->MEL_BIN[r+2] - p->MEL_BIN[r+1]);
    }
    return 0.0;
}

void _apply_mel_filter(struct VocoderInternal *p){
    const int M = p->mel_num_bands;
    const int N = p->window_size/2 + 1;

    float *in  = p->mel_amps;     // original magnitudes
    float *bands = p->mel_bands;  // mel band energies
    int *B = p->MEL_BIN;

    // Temporary buffer for reconstructed magnitudes (stack allocation)
    float *tmp = alloca(sizeof(float) * N);

    // 1. Compute mel-band energies
    for (int r = 0; r < M; ++r){
        int b0 = B[r];
        int b1 = B[r+1];
        int b2 = B[r+2];

        float acc = 0.0f;

        // rising + falling together
        for (int c = b0; c <= b2 && c < N; ++c) {
            float w = _calc_mel_filter_val(p, r, c);
            if (w > 0.0f){
                acc += w * in[c];
            }
        }

        bands[r] = acc;
    }

    // 2. Reconstruct spectrum into tmp
    memset(tmp, 0, sizeof(float) * N);

    for (int r = 0; r < M; ++r){
        int b0 = B[r];
        int b1 = B[r+1];
        int b2 = B[r+2];
        float e = bands[r];

        if (e == 0.0f) continue;

        for (int c = b0; c <= b2 && c < N; ++c){
            float w = _calc_mel_filter_val(p, r, c);
            if (w > 0.0f){
                tmp[c] += w * e;
            }
        }
    }

    // 3. Preserve bins outside mel range
    int left  = B[0];
    int right = B[M+1];

    for (int c = 0; c < left && c < N; ++c){
        tmp[c] = in[c];
    }

    for (int c = right+1; c < N; ++c){
        tmp[c] = in[c];
    }

    // 4. Copy reconstructed spectrum back into mel_amps
    memcpy(in, tmp, sizeof(float) * N);
}
