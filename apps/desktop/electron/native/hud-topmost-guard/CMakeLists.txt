cmake_minimum_required(VERSION 3.20)
project(hud-topmost-guard LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(hud-topmost-guard src/main.cpp)

target_link_libraries(hud-topmost-guard PRIVATE user32)
