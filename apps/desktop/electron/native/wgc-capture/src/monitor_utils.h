#pragma once

#include <cstdint>
#include <windows.h>
#include <string>
#include <vector>

struct MonitorInfo {
    HMONITOR handle;
    int x;
    int y;
    int width;
    int height;
    std::wstring deviceName;
};

std::vector<MonitorInfo> enumerateMonitors();
HMONITOR findMonitorByDisplayId(int64_t displayId);
HMONITOR findMonitorByBounds(int x, int y, int width, int height);
MonitorInfo getMonitorInfo(HMONITOR monitor);
