#include <stdio.h>
#include <math.h>
#include <assert.h>
#include <string.h>
#include "../src/stftinternal.c"
#include "../../kissfft/kiss_fftr.h"

#define EPS 1e-6f
#define TEST_SIGNAL_LENGTH (WINDOW_SIZE * 4)
// TODO remove
#define WINDOW_SIZE 1024
#define HOP_SIZE 512

// TODO make test for vocoder

static void test_hann_cola(void) {
    struct StftInternal *p = stft_internal_create(WINDOW_SIZE,HOP_SIZE);

    // Accumulate overlapped windows
    double sum[WINDOW_SIZE] = {0};
    for (int k = 0; k < WINDOW_SIZE / HOP_SIZE; ++k) {
        int offset = k * HOP_SIZE;
        for (int i = 0; i < WINDOW_SIZE; ++i) {
            int pos = (offset + i) % WINDOW_SIZE;
            sum[pos] += p->HANN[i] * (2.0f/(WINDOW_SIZE/HOP_SIZE));
        }
    }

    // COLA condition: overlap sums ≈ constant
    float mean = 0.0f;
    for (int i = 0; i < WINDOW_SIZE; ++i){
        mean += sum[i];
    }
    mean /= WINDOW_SIZE;

    for (int i = 0; i < WINDOW_SIZE; ++i){
        assert(fabsf(sum[i] - mean) < EPS);
    }

    printf("✅ COLA condition satisfied (overlap sum = %.6f)\n", mean);
    if (fabsf(mean-1.0f) < EPS){
        printf("✅ COLA sums to 1.0\n");
    } else {
        printf("⚠️ COLA not equal to 1.0\n");
    }

    stft_internal_destroy(p);
}

static void test_fft_magnitude(void) {
    kiss_fftr_cfg fwd = kiss_fftr_alloc(WINDOW_SIZE, 0, NULL, NULL);
    kiss_fftr_cfg inv = kiss_fftr_alloc(WINDOW_SIZE, 1, NULL, NULL);

    float timeIn[WINDOW_SIZE] = {0};
    float timeOut[WINDOW_SIZE] = {0};
    kiss_fft_cpx freq[WINDOW_SIZE/2 + 1];

    timeIn[0] = 1.0f;

    kiss_fftr(fwd, timeIn, freq);
    kiss_fftri(inv, freq, timeOut);

    // Normalize by WINDOW_SIZE (the same as your stft_internal_process)
    for (int i = 0; i < WINDOW_SIZE; ++i){
        timeOut[i] /= WINDOW_SIZE;
    }

    // Check equivalence
    for (int i = 0; i < WINDOW_SIZE; ++i) {
        float expected = timeIn[i];
        assert(fabsf(timeOut[i] - expected) < EPS);
    }

    printf("✅ FFT + IFFT scaling test passed\n");

    free(fwd);
    free(inv);
}

static void dump_arrays_to_csv(const char *filename, const float *input, const float *output, int n){
    FILE *f = fopen(filename, "w");
    if (!f) {
        perror("fopen");
        return;
    }

    fprintf(f, "index,input,output\n");
    for (int i = 0; i < n; ++i)
        fprintf(f, "%d,%.8f,%.8f\n", i, input[i], output[i]);

    fclose(f);
    printf("Wrote %d samples to %s\n", n, filename);
}

static void test_stft_reconstruction(void) {
    struct StftInternal* stft = stft_internal_create(WINDOW_SIZE,HOP_SIZE);
    if (!stft) {
        printf("❌ STFT allocation failed.\n");
        return;
    }

    float input[TEST_SIGNAL_LENGTH + WINDOW_SIZE] = {0.0};
    float output[TEST_SIGNAL_LENGTH + WINDOW_SIZE] = {0.0};
    memset(output, 0, sizeof(output));

    // Test signal: sine wave
    double sr = 48000.0;
    for (int i = 0; i < TEST_SIGNAL_LENGTH; ++i){
        input[i] += 2.0*sin(2.0 * M_PI * 440.0 * i / sr);
        input[i] += sin(2.0 * M_PI * 500.0 * i / sr + 1.2);
    }

    int pos = 0;

    // --- Main streaming loop ---
    while (pos + QUANTUM_SIZE <= TEST_SIGNAL_LENGTH) {
        float* inPtr = stft_internal_next_input_quantum_ptr(stft);
        memcpy(inPtr, input+pos, sizeof(float) * QUANTUM_SIZE);

        // TODO move copy out here

        stft_internal_process(stft);

        float* outPtr = stft_internal_next_output_quantum_ptr(stft);
        memcpy(output+pos, outPtr, sizeof(float) * QUANTUM_SIZE);

        pos += QUANTUM_SIZE;
    }

    // --- Flush stage (feed zeros) ---
    int flush_blocks = WINDOW_SIZE / QUANTUM_SIZE;
    for (int f = 0; f < flush_blocks; ++f) {
        float* inPtr = stft_internal_next_input_quantum_ptr(stft);
        memset(inPtr, 0, sizeof(float) * QUANTUM_SIZE);
        stft_internal_process(stft);

        float* outPtr = stft_internal_next_output_quantum_ptr(stft);
        int out_pos = pos + f * QUANTUM_SIZE;
        memcpy(output+out_pos, outPtr, sizeof(float) * QUANTUM_SIZE);
    }

    // Dump the full arrays for external inspection
    dump_arrays_to_csv("build/stft_debug.csv", input, output, TEST_SIGNAL_LENGTH + WINDOW_SIZE);


    // --- Compare only the valid portion ---
    double mse = 0.0;
    for (int i = 0; i < TEST_SIGNAL_LENGTH; ++i) {
        // Apparently the delay is WINDOW_SIZE-QUANTUM_SIZE samples
        float diff = input[i] - output[i+WINDOW_SIZE-QUANTUM_SIZE];
        mse += diff * diff;
    }
    mse /= TEST_SIGNAL_LENGTH;

    if (mse < EPS){
        printf("✅ STFT reconstruction successful (MSE = %.8g)\n", mse);
    } else {
        printf("⚠️ STFT reconstruction failed (MSE = %.8g)\n", mse);
    }

    stft_internal_destroy(stft);
}


int main(void) {
    test_hann_cola();
    test_fft_magnitude();
    test_stft_reconstruction();
    printf("All tests finished.\n");
    return 0;
}
