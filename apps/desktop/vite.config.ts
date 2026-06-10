import { defineConfig } from "vite";
import path from "node:path";
import electron from "vite-plugin-electron/simple";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const manualChunks = (id: string) => {
  if (!id.includes("node_modules")) {
    return undefined;
  }

  if (id.includes("node_modules/pixi.js/")) {
    return "pixi";
  }

  if (
    id.includes("node_modules/react/") ||
    id.includes("node_modules/react-dom/")
  ) {
    return "react-vendor";
  }

  if (
    id.includes("node_modules/mediabunny/") ||
    id.includes("node_modules/mp4box/") ||
    id.includes("node_modules/@fix-webm-duration/fix/")
  ) {
    return "video-processing";
  }

  return undefined;
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),

    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: "electron/main.ts",
        vite: {
          resolve: {
            alias: {
              "@": path.resolve(__dirname, "src"),
              "@electron": path.resolve(__dirname, "electron"),
            },
          },
          build: {
            lib: {
              entry: "electron/main.ts",
              formats: ["cjs"],
            },
            rollupOptions: {
              external: ["electron-updater", "ffmpeg-static", "uiohook-napi"],
              output: {
                format: "cjs",
                entryFileNames: "[name].cjs",
                chunkFileNames: "[name].cjs",
              },
            },
          },
          // plugins: [electronMainCjsGuardPlugin()],
        },
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: path.join(__dirname, "electron/preload.ts"),
        vite: {
          // It's also a good idea to add it here if your preload scripts use the alias
          resolve: {
            alias: {
              "@": path.resolve(__dirname, "src"),
              "@electron": path.resolve(__dirname, "electron"),
            },
          },
        },
      },
      // Ployfill the Electron and Node.js API for Renderer process.
      // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
      // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer:
        process.env.NODE_ENV === "test"
          ? // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
            undefined
          : {},
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@electron": path.resolve(__dirname, "electron"),
    },
  },
  build: {
    target: "esnext",
    minify: "terser",
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ["console.log", "console.debug"],
      },
    },
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
    chunkSizeWarningLimit: 1000,
  },
});
