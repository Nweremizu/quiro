#include <windows.h>
#include <cstdio>
#include <iostream>
#include <string>
#include <thread>
#include <atomic>
#include <unordered_map>

static std::atomic<bool> g_running{true};

static void stdinListener()
{
    std::string line;
    while (std::getline(std::cin, line))
    {
        if (line == "stop")
        {
            g_running.store(false);
            return;
        }
    }
    g_running.store(false);
}

int main()
{
    std::setvbuf(stdout, nullptr, _IONBF, 0);

    std::unordered_map<HCURSOR, std::string> cursorMap;
    cursorMap[LoadCursor(NULL, IDC_ARROW)] = "arrow";
    cursorMap[LoadCursor(NULL, IDC_IBEAM)] = "text";
    cursorMap[LoadCursor(NULL, IDC_HAND)] = "pointer";
    cursorMap[LoadCursor(NULL, IDC_CROSS)] = "crosshair";
    cursorMap[LoadCursor(NULL, IDC_NO)] = "not-allowed";
    cursorMap[LoadCursor(NULL, IDC_SIZEWE)] = "resize-ew";
    cursorMap[LoadCursor(NULL, IDC_SIZENS)] = "resize-ns";
    cursorMap[LoadCursor(NULL, IDC_SIZEALL)] = "open-hand";
    cursorMap[LoadCursor(NULL, IDC_WAIT)] = "arrow";
    cursorMap[LoadCursor(NULL, IDC_APPSTARTING)] = "arrow";

    std::thread listener(stdinListener);
    listener.detach();

    std::string lastType;

    while (g_running.load())
    {
        CURSORINFO ci = {};
        ci.cbSize = sizeof(ci);

        if (GetCursorInfo(&ci) && (ci.flags & CURSOR_SHOWING))
        {
            auto it = cursorMap.find(ci.hCursor);
            std::string type = (it != cursorMap.end()) ? it->second : "arrow";

            if (type != lastType)
            {
                lastType = type;
                std::cout << "STATE:" << type << std::endl;
            }
        }

        Sleep(50);
    }

    return 0;
}
