cmake_minimum_required(VERSION 3.24)

project(quiro_nvidia_cuda_compositor LANGUAGES CXX CUDA)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CUDA_STANDARD 17)
set(CMAKE_CUDA_STANDARD_REQUIRED ON)

set(QUIRO_NVIDIA_VIDEO_CODEC_SDK_ROOT
  "${CMAKE_CURRENT_LIST_DIR}/../../../.tmp/video-sdk-samples"
  CACHE PATH
  "Path to the NVIDIA Video Codec SDK samples checkout"
)
set(NVIDIA_SAMPLES_DIR "${QUIRO_NVIDIA_VIDEO_CODEC_SDK_ROOT}/Samples")
set(NVCODEC_DIR "${NVIDIA_SAMPLES_DIR}/NvCodec")

if(NOT EXISTS "${NVCODEC_DIR}")
  message(FATAL_ERROR "NVIDIA Video Codec SDK NvCodec directory not found: ${NVCODEC_DIR}. Set QUIRO_NVIDIA_VIDEO_CODEC_SDK_ROOT.")
endif()

add_executable(quiro-nvidia-cuda-compositor
  src/main.cu
  "${NVCODEC_DIR}/NvDecoder/NvDecoder.cpp"
  "${NVCODEC_DIR}/NvEncoder/NvEncoder.cpp"
  "${NVCODEC_DIR}/NvEncoder/NvEncoderCuda.cpp"
)

target_include_directories(quiro-nvidia-cuda-compositor PRIVATE
  "${NVIDIA_SAMPLES_DIR}"
  "${NVCODEC_DIR}"
)

target_compile_definitions(quiro-nvidia-cuda-compositor PRIVATE
  NOMINMAX
  WIN32_LEAN_AND_MEAN
)

find_package(CUDAToolkit REQUIRED)
target_link_libraries(quiro-nvidia-cuda-compositor PRIVATE
  CUDA::cuda_driver
  "${NVCODEC_DIR}/Lib/x64/nvcuvid.lib"
)

set_target_properties(quiro-nvidia-cuda-compositor PROPERTIES
  CUDA_SEPARABLE_COMPILATION OFF
)
