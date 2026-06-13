import { useEffect, useRef, useState } from "react";
import { detectWebglRenderer } from "@/lib/systemHealth";

interface ProcessMetric {
  pid: number;
  type: string;
  cpu: number;
  memMb: number;
}

interface IpcStat {
  channel: string;
  calls: number;
  avgMs: number;
  maxMs: number;
  slowCount: number;
}

interface PerfSnapshot {
  processes: ProcessMetric[];
  ipc: IpcStat[];
}

function fpsColor(fps: number) {
  if (fps >= 50) return "#4ade80";
  if (fps >= 30) return "#facc15";
  return "#f87171";
}

function cpuColor(pct: number) {
  if (pct > 40) return "#f87171";
  if (pct > 15) return "#facc15";
  return "#4ade80";
}

function latColor(ms: number) {
  if (ms > 50) return "#f87171";
  if (ms > 16) return "#facc15";
  return "#e2e8f0";
}

const BASE: React.CSSProperties = {
  position: "fixed",
  top: 8,
  right: 8,
  zIndex: 99999,
  fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
  fontSize: 11,
  lineHeight: 1.45,
  color: "#e2e8f0",
  background: "rgba(8, 8, 12, 0.90)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 10,
  padding: "10px 13px",
  width: 280,
  backdropFilter: "blur(8px)",
  pointerEvents: "none",
  userSelect: "none",
};

const LABEL: React.CSSProperties = {
  color: "#475569",
  fontSize: 9,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  marginBottom: 3,
};

const DIVIDER: React.CSSProperties = {
  borderTop: "1px solid rgba(255,255,255,0.06)",
  margin: "8px 0",
};

export function PerfOverlay() {
  const [visible, setVisible] = useState(false);
  const [fps, setFps] = useState(60);
  const [heapMb, setHeapMb] = useState(0);
  const [rttMs, setRttMs] = useState<number | null>(null);
  const [snap, setSnap] = useState<PerfSnapshot | null>(null);
  const [gpuInfo, setGpuInfo] = useState<{
    renderer: string | null;
    isSoftware: boolean;
  } | null>(null);
  const frameRef = useRef({ count: 0, lastTs: 0 });

  // GPU detection — once, on first open
  useEffect(() => {
    if (!visible || gpuInfo) return;
    setGpuInfo(detectWebglRenderer());
  }, [visible, gpuInfo]);

  // FPS counter — always running so the number is ready when overlay opens
  useEffect(() => {
    let raf: number;
    frameRef.current.lastTs = performance.now();
    function tick() {
      frameRef.current.count++;
      const now = performance.now();
      const dt = now - frameRef.current.lastTs;
      if (dt >= 800) {
        setFps(Math.round((frameRef.current.count * 1000) / dt));
        frameRef.current.count = 0;
        frameRef.current.lastTs = now;
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Heap + IPC snapshot — only poll while visible
  useEffect(() => {
    if (!visible) return;

    const poll = async () => {
      if ("memory" in performance) {
        // Chrome/Electron-specific: JS heap size
        setHeapMb(
          Math.round(
            (performance as unknown as { memory: { usedJSHeapSize: number } })
              .memory.usedJSHeapSize /
              1024 /
              1024,
          ),
        );
      }
      try {
        const t0 = performance.now();
        // perfSnapshot is added at runtime; cast to avoid ambient-type lag
        const perfFn = (
          window.electronAPI as unknown as {
            perfSnapshot?: () => Promise<PerfSnapshot>;
          }
        ).perfSnapshot;
        const snapshot = perfFn ? await perfFn() : null;
        setRttMs(Math.round(performance.now() - t0));
        if (snapshot) setSnap(snapshot);
      } catch {
        // perf handlers not yet registered — no-op
      }
    };

    void poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [visible]);

  // Ctrl+Shift+P toggle
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "P" || e.key === "p")) {
        e.preventDefault();
        setVisible((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!visible) return null;

  const hotIpc = snap?.ipc.filter((c) => c.slowCount > 0 || c.avgMs > 8) ?? [];

  return (
    <div style={BASE}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <span style={{ color: "#94a3b8", fontWeight: 700, fontSize: 10 }}>
          ⚡ PERF MONITOR
        </span>
        <span style={{ color: "#334155", fontSize: 9 }}>Ctrl+Shift+P</span>
      </div>

      {/* FPS / Heap / RTT row */}
      <div style={{ display: "flex", gap: 18, marginBottom: 6 }}>
        <div>
          <div style={LABEL}>FPS</div>
          <div
            style={{ color: fpsColor(fps), fontSize: 22, fontWeight: 800 }}
          >
            {fps}
          </div>
        </div>
        <div>
          <div style={LABEL}>JS Heap</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{heapMb} MB</div>
        </div>
        {rttMs !== null && (
          <div>
            <div style={LABEL}>IPC RTT</div>
            <div
              style={{
                color: latColor(rttMs),
                fontSize: 22,
                fontWeight: 800,
              }}
            >
              {rttMs}ms
            </div>
          </div>
        )}
      </div>

      {/* GPU status */}
      {gpuInfo && (
        <div style={{ marginBottom: 6 }}>
          <div style={LABEL}>GPU</div>
          <div
            style={{
              color: gpuInfo.isSoftware ? "#f87171" : "#4ade80",
              fontSize: 10,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={gpuInfo.renderer ?? undefined}
          >
            {gpuInfo.isSoftware ? "⚠ SOFTWARE — " : "✓ HW — "}
            {gpuInfo.renderer ?? "unknown"}
          </div>
        </div>
      )}

      {/* Processes */}
      {snap && snap.processes.length > 0 && (
        <>
          <div style={DIVIDER} />
          <div style={{ ...LABEL, marginBottom: 5 }}>Processes</div>
          {snap.processes.map((p) => (
            <div
              key={p.pid}
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 3,
              }}
            >
              <span style={{ color: "#64748b" }}>
                {p.type}
                <span style={{ color: "#334155", marginLeft: 4 }}>
                  {p.pid}
                </span>
              </span>
              <span>
                <span style={{ color: cpuColor(p.cpu) }}>{p.cpu}%</span>
                <span style={{ color: "#334155", marginLeft: 8 }}>
                  {p.memMb} MB
                </span>
              </span>
            </div>
          ))}
        </>
      )}

      {/* Hot IPC channels */}
      {hotIpc.length > 0 && (
        <>
          <div style={DIVIDER} />
          <div style={{ ...LABEL, marginBottom: 5 }}>Slow IPC Channels</div>
          {hotIpc.slice(0, 7).map((c) => (
            <div
              key={c.channel}
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 3,
              }}
            >
              <span
                style={{
                  color: "#64748b",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: 170,
                }}
              >
                {c.channel}
              </span>
              <span style={{ flexShrink: 0, marginLeft: 8 }}>
                <span style={{ color: latColor(c.avgMs) }}>{c.avgMs}ms</span>
                <span style={{ color: "#334155", marginLeft: 5 }}>
                  ×{c.calls}
                </span>
                {c.slowCount > 0 && (
                  <span style={{ color: "#f87171", marginLeft: 4 }}>
                    ⚠{c.slowCount}
                  </span>
                )}
              </span>
            </div>
          ))}
        </>
      )}

      {snap && hotIpc.length === 0 && (
        <div style={{ color: "#1e293b", fontSize: 10, marginTop: 4 }}>
          No slow IPC channels detected
        </div>
      )}
    </div>
  );
}
