#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <vector>
#include <string>

using namespace emscripten;


float _mean_internal(const std::vector<float>& arr) {
    float s = 0;
    for (float v : arr) s += v;
    return s/arr.size();
}

float mean(val input) {
    if (input.isArray()) {
        std::vector<float> v = vecFromJSArray<float>(input);
        return _mean_internal(v);
    }
    
    throw std::runtime_error("Unsupported type");
}


EMSCRIPTEN_BINDINGS(my_module) {
    function("mean", &mean);
}

