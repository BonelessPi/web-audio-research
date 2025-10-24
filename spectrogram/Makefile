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
DEBUG_FLAGS = -O0 -gsource-map -sASSERTIONS=1 -Wall -sSAFE_HEAP=1 -sSAFE_HEAP_LOG=1 -sSTRICT
RELEASE_FLAGS = -O3

# Default target = release build
all: release

# Release build
release: CXXFLAGS += $(RELEASE_FLAGS)
release: $(BUILD_DIR)/$(TARGET).wasm

# Debug build
debug: CXXFLAGS += $(DEBUG_FLAGS)
debug: $(BUILD_DIR)/$(TARGET).wasm

test: test/test_all.c
	gcc test/test_all.c ../kissfft/kiss_fftr.c ../kissfft/kiss_fft.c -lm -o build/testing_out -Wall -fsanitize=address -static-libasan -g
	./build/testing_out
	echo
	gcc test/test_all.c ../kissfft/kiss_fftr.c ../kissfft/kiss_fft.c -lm -o build/testing_out -Wall
	valgrind --leak-check=full --show-leak-kinds=all --track-origins=yes ./build/testing_out

# Build stftinternal
$(BUILD_DIR)/$(TARGET).wasm: $(SRC_DIR)/$(TARGET).c
	@mkdir -p $(BUILD_DIR)
	$(EMCC) $< ../kissfft/kiss_fftr.c ../kissfft/kiss_fft.c -o $@ $(CXXFLAGS)

# Clean build artifacts
clean:
	rm -f $(BUILD_DIR)/*
