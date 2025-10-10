#include <emscripten/webaudio.h>
#include <emscripten/em_math.h>
#include <emscripten/console.h>
#include <emscripten/bind.h>

#define AUDIO_PROCESSOR_NAME "noise-generator"

static bool GenerateNoise(int numInputs, const AudioSampleFrame *inputs,
                          int numOutputs, AudioSampleFrame *outputs,
                          int numParams, const AudioParamFrame *params,
                          void *userData)
{
  for (int i = 0; i < numOutputs; ++i)
  {
    int n = outputs[i].samplesPerChannel * outputs[i].numberOfChannels;
    for (int j = 0; j < n; ++j)
      outputs[i].data[j] = emscripten_random() * 0.2f - 0.1f;
  }
  return true;
}

extern "C" {

EMSCRIPTEN_KEEPALIVE
void register_noise_processor(EMSCRIPTEN_WEBAUDIO_T ctx)
{
  WebAudioWorkletProcessorCreateOptions opts = {.name = AUDIO_PROCESSOR_NAME};
  emscripten_create_wasm_audio_worklet_processor_async(
      ctx, &opts,
      [](EMSCRIPTEN_WEBAUDIO_T, EM_BOOL success, void *)
      {
        if (success)
          emscripten_console_log("Noise processor registered");
        else
          emscripten_console_error("Noise processor registration failed");
      },
      0);
}

EMSCRIPTEN_KEEPALIVE
EMSCRIPTEN_AUDIO_WORKLET_NODE_T create_noise_node(EMSCRIPTEN_WEBAUDIO_T ctx)
{
  int channels[1] = {1};
  EmscriptenAudioWorkletNodeCreateOptions opts = {
      .numberOfInputs = 0,
      .numberOfOutputs = 1,
      .outputChannelCounts = channels};
  return emscripten_create_wasm_audio_worklet_node(ctx, AUDIO_PROCESSOR_NAME,
                                                   &opts, &GenerateNoise, 0);
}

} // extern "C"

// -----------------------------------------------------------------------------
// Embed JS helper to be called from your spectrogram
// -----------------------------------------------------------------------------
EM_ASYNC_JS(void, setupWasmNoiseExports, (), {
  /**
   * Creates a WASM noise node attached to an existing JS AudioContext.
   * @param {AudioContext} audioCtx - the spectrogram's existing AudioContext
   */
  Module.createWasmNoiseNode = async function(audioCtx) {
    // Allocate stack memory for the audio worklet thread
    const stack = Module._malloc(4096);

    // Register the JS AudioContext so C++ can access it
    const ctxHandle = Module._emscripten_register_audio_object(0, audioCtx);

    // Start the WASM audio thread
    Module._emscripten_start_wasm_audio_worklet_thread_async(
      ctxHandle, stack, 4096,
      Module.addFunction((ctx, success, ud) => {
        console.log("Worklet thread started:", success);
      }, 'viii'),
      0
    );

    // Register the processor
    Module._register_noise_processor(ctxHandle);
    await new Promise(r => setTimeout(r, 300));

    // Create node
    const nodeHandle = Module._create_noise_node(ctxHandle);
    const node = Module.wrapPointer(nodeHandle);

    return node;
  };
});

// Call once at module load to install the helper
EMSCRIPTEN_BINDINGS(init) {
  emscripten::function("setupWasmNoiseExports", &setupWasmNoiseExports);
}
