# Project settings
SRC_DIR = src
BUILD_DIR = build
TARGET = mylib

# Compiler
EMCC = emcc

# Find all source files automatically
SOURCES = $(wildcard $(SRC_DIR)/*.cpp)

# Common flags
CXXFLAGS = \
	-lembind \
	-sMODULARIZE \
	-sEXPORT_ES6=1 \
	-sENVIRONMENT=web \
	-sALLOW_MEMORY_GROWTH \
	--no-entry

# Debug / Release flags
DEBUG_FLAGS = -O0 -gsource-map
RELEASE_FLAGS = -O3

# Default target = release build
all: release

# Release build
release: CXXFLAGS += $(RELEASE_FLAGS)
release: $(BUILD_DIR)/$(TARGET).js

# Debug build
debug: CXXFLAGS += $(DEBUG_FLAGS)
debug: $(BUILD_DIR)/$(TARGET).js

# Pattern rule for building the target
$(BUILD_DIR)/$(TARGET).js: $(SOURCES)
	@mkdir -p $(BUILD_DIR)
	$(EMCC) $(SOURCES) -o $@ $(CXXFLAGS)

# Clean build artifacts
clean:
	rm -f $(BUILD_DIR)/*

