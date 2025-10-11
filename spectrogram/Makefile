# Project settings
SRC_DIR = src
BUILD_DIR = build
TARGET = stftinternal

# Compiler
EMCC = emcc

# Common flags
CXXFLAGS = \
	-sSTANDALONE_WASM=1 \
	-sENVIRONMENT=web \
	-sALLOW_MEMORY_GROWTH \
	-sEXPORTED_FUNCTIONS="['_stft_internal_create','_stft_internal_destroy','_stft_internal_process','_stft_internal_next_input_quantum_ptr','_stft_internal_next_output_quantum_ptr']" \
	--no-entry

# Debug / Release flags
DEBUG_FLAGS = -O0 -gsource-map
RELEASE_FLAGS = -O3

# Default target = release build
all: release

# Release build
release: CXXFLAGS += $(RELEASE_FLAGS)
release: $(BUILD_DIR)/$(TARGET).wasm

# Debug build
debug: CXXFLAGS += $(DEBUG_FLAGS)
debug: $(BUILD_DIR)/$(TARGET).wasm

# Build stftinternal
$(BUILD_DIR)/$(TARGET).wasm: $(SRC_DIR)/$(TARGET).cpp
	@mkdir -p $(BUILD_DIR)
	$(EMCC) $< -o $@ $(CXXFLAGS)

# Clean build artifacts
clean:
	rm -f $(BUILD_DIR)/*
