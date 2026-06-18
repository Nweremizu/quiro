// Builds a branded PDF of the Quiro AI vision brief using Playwright Chromium.
// Run: node scripts/build-vision-pdf.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const logoPath = resolve(root, 'apps/web/public/app-icons/quiro-512.png');
const outPath = resolve(root, 'docs/Quiro-AI-Native-Vision.pdf');

const logoDataUri =
  'data:image/png;base64,' + readFileSync(logoPath).toString('base64');

const html = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  :root{
    --ink:#0c0c0e;
    --ink-soft:#1b1d24;
    --body:#33384a;
    --muted:#7c8190;
    --accent:#e2611c;
    --accent-2:#f08030;
    --accent-tint:#fdf1e9;
    --accent-line:#f3b483;
    --line:#e9e5e0;
    --panel:#faf8f6;
    --cover:#0c0c0e;
  }
  *{ box-sizing:border-box; }
  html,body{ margin:0; padding:0; }
  body{
    font-family:"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
    color:var(--body);
    font-size:10.4pt;
    line-height:1.5;
    -webkit-font-smoothing:antialiased;
  }
  h1,h2,h3{ color:var(--ink); margin:0; line-height:1.18; letter-spacing:-0.01em; }
  p{ margin:0 0 8px; }
  strong{ color:var(--ink-soft); }
  a{ color:var(--accent); text-decoration:none; }
  code{
    font-family:"Cascadia Code","SFMono-Regular",Consolas,monospace;
    font-size:9pt; background:#f3f0ec; color:#b4480f;
    padding:1px 5px; border-radius:5px;
  }

  /* ─── Cover ─────────────────────────────── */
  .cover{ break-after:page; }
  .hero{
    background:var(--cover);
    color:#fff;
    border-radius:18px;
    padding:34px 34px 30px;
    position:relative;
    overflow:hidden;
  }
  .hero::after{
    content:""; position:absolute; right:-90px; top:-90px;
    width:320px; height:320px; border-radius:50%;
    background:radial-gradient(circle at center, rgba(226,97,28,.55), rgba(226,97,28,0) 68%);
  }
  .hero-logo{ width:54px; height:54px; filter:invert(1); position:relative; z-index:1; }
  .hero-kicker{
    position:relative; z-index:1;
    margin-top:22px; font-size:8.5pt; letter-spacing:.32em; text-transform:uppercase;
    color:var(--accent-2); font-weight:600;
  }
  .hero h1{
    position:relative; z-index:1;
    color:#fff; font-size:38pt; font-weight:800; margin-top:8px; letter-spacing:-0.02em;
  }
  .hero-sub{
    position:relative; z-index:1;
    color:#c8ccd6; font-size:13pt; font-weight:500; margin-top:2px;
  }
  .hero-rule{
    position:relative; z-index:1;
    width:64px; height:4px; border-radius:3px; background:var(--accent); margin:20px 0 16px;
  }
  .hero-oneliner{
    position:relative; z-index:1;
    color:#e9ebf0; font-size:11.5pt; line-height:1.5; max-width:88%; margin:0;
  }
  .hero-oneliner em{ color:#fff; font-style:italic; }

  .meta{
    margin-top:22px;
    display:grid; grid-template-columns:repeat(4,1fr); gap:12px;
  }
  .meta div{
    border:1px solid var(--line); border-radius:12px; padding:12px 14px; background:var(--panel);
  }
  .meta .k{ font-size:7.6pt; letter-spacing:.16em; text-transform:uppercase; color:var(--muted); font-weight:600; }
  .meta .v{ font-size:11pt; color:var(--ink); font-weight:700; margin-top:3px; }

  .toc{ margin-top:20px; }
  .toc-title{ font-size:8pt; letter-spacing:.18em; text-transform:uppercase; color:var(--muted); font-weight:700; margin-bottom:8px; }
  .toc-grid{ display:grid; grid-template-columns:1fr 1fr; gap:5px 26px; }
  .toc-row{ display:flex; gap:10px; font-size:9.6pt; color:var(--body); align-items:baseline; }
  .toc-row b{ color:var(--accent); font-weight:700; min-width:16px; }

  /* ─── Sections ──────────────────────────── */
  .sec{ margin-top:22px; break-inside:avoid; }
  .sec-head{ display:flex; align-items:center; gap:11px; margin-bottom:9px; break-after:avoid; }
  .sec-num{
    flex:0 0 auto; width:26px; height:26px; border-radius:8px;
    background:var(--ink); color:#fff; font-size:10.5pt; font-weight:700;
    display:flex; align-items:center; justify-content:center;
  }
  .sec-head h2{ font-size:15.5pt; font-weight:750; }
  .sec-body{ padding-left:37px; }
  ul{ margin:6px 0 8px; padding-left:18px; }
  li{ margin:3px 0; }

  .callout{
    background:var(--accent-tint); border:1px solid var(--accent-line);
    border-left:4px solid var(--accent);
    border-radius:10px; padding:13px 16px; margin:4px 0 8px;
    break-inside:avoid;
  }
  .callout .lab{ font-size:7.6pt; letter-spacing:.16em; text-transform:uppercase; color:var(--accent); font-weight:700; margin-bottom:4px; }
  .callout p{ margin:0; color:var(--ink-soft); }
  .callout em{ color:var(--ink); }

  table{ width:100%; border-collapse:collapse; margin:8px 0 10px; font-size:9.2pt; break-inside:avoid; }
  thead th{
    background:var(--ink); color:#fff; text-align:left; font-weight:600;
    padding:8px 10px; font-size:8.6pt; letter-spacing:.02em;
  }
  thead th:first-child{ border-top-left-radius:8px; }
  thead th:last-child{ border-top-right-radius:8px; }
  tbody td{ padding:7px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
  tbody tr:nth-child(even){ background:var(--panel); }
  td.win{ color:var(--ink); font-weight:600; }
  .col-quiro{ background:var(--accent-tint) !important; }
  thead th.col-quiro{ background:var(--accent); }

  .tier{ margin:10px 0; break-inside:avoid; }
  .tier-tag{
    display:inline-block; font-size:7.8pt; font-weight:700; letter-spacing:.06em;
    text-transform:uppercase; padding:3px 9px; border-radius:20px; margin-bottom:5px;
  }
  .t0{ background:#eceae7; color:#54585f; }
  .t1{ background:var(--accent); color:#fff; }
  .t2{ background:var(--ink); color:#fff; }
  .t3{ background:var(--accent-tint); color:var(--accent); border:1px solid var(--accent-line); }
  .tier h3{ font-size:11pt; display:inline-block; margin-left:8px; vertical-align:middle; }

  .demo-steps{ counter-reset:step; list-style:none; padding-left:0; margin:6px 0; }
  .demo-steps li{ position:relative; padding-left:30px; margin:6px 0; }
  .demo-steps li::before{
    counter-increment:step; content:counter(step);
    position:absolute; left:0; top:1px; width:20px; height:20px; border-radius:6px;
    background:var(--accent); color:#fff; font-size:8.5pt; font-weight:700;
    display:flex; align-items:center; justify-content:center;
  }

  .pull{
    border-left:3px solid var(--accent); padding:4px 0 4px 14px; margin:8px 0;
    color:var(--ink-soft); font-size:11pt; font-style:italic;
  }
  .closing{
    margin-top:26px; padding-top:14px; border-top:1px solid var(--line);
    font-size:9pt; color:var(--muted); font-style:italic;
  }
</style>
</head>
<body>

<!-- ───────── COVER ───────── -->
<section class="cover">
  <div class="hero">
    <img class="hero-logo" src="${logoDataUri}" alt="Quiro" />
    <div class="hero-kicker">Product Vision &middot; Hackathon Brief</div>
    <h1>Quiro&nbsp;AI</h1>
    <div class="hero-sub">Edit your screen recording by talking to it.</div>
    <div class="hero-rule"></div>
    <p class="hero-oneliner">Quiro turns a messy screen recording into a polished demo <em>while you talk to it.</em> You record; you say what you want in plain language; the timeline edits itself.</p>
  </div>

  <div class="meta">
    <div><div class="k">Owner</div><div class="v">Bruno</div></div>
    <div><div class="k">Status</div><div class="v">Proposal</div></div>
    <div><div class="k">Updated</div><div class="v">Jun 17, 2026</div></div>
    <div><div class="k">Version</div><div class="v">v1 Draft</div></div>
  </div>

  <div class="toc">
    <div class="toc-title">What's inside</div>
    <div class="toc-grid">
      <div class="toc-row"><b>1</b><span>The problem we're solving</span></div>
      <div class="toc-row"><b>7</b><span>Why we're different</span></div>
      <div class="toc-row"><b>2</b><span>Our insight — why Quiro</span></div>
      <div class="toc-row"><b>8</b><span>Hackathon scope (MVP)</span></div>
      <div class="toc-row"><b>3</b><span>The vision — Quiro Director</span></div>
      <div class="toc-row"><b>9</b><span>Tech approach</span></div>
      <div class="toc-row"><b>4</b><span>The core — the Recording Brain</span></div>
      <div class="toc-row"><b>10</b><span>The demo</span></div>
      <div class="toc-row"><b>5</b><span>What we're adding</span></div>
      <div class="toc-row"><b>11</b><span>Risks &amp; open questions</span></div>
      <div class="toc-row"><b>6</b><span>How it fits our architecture</span></div>
      <div class="toc-row"><b>12</b><span>Suggested workstreams</span></div>
    </div>
  </div>
</section>

<!-- ───────── TL;DR ───────── -->
<section class="sec">
  <div class="sec-head"><div class="sec-num" style="background:var(--accent)">TL</div><h2>TL;DR</h2></div>
  <div class="sec-body">
    <p>Editing a screen recording takes far longer than recording it. Today Quiro gives users powerful <strong>manual</strong> tools (zoom, trim, speed, captions, annotations). We want to make Quiro <strong>AI-native</strong>: a conversational agent that <strong>understands</strong> the recording and <strong>edits it for the user</strong> by driving the same tools they'd use by hand.</p>
    <p>Because every edit in Quiro is already structured data (regions), the AI doesn't need to "drive a UI" — it reads and writes regions directly. That is our unfair advantage and the reason we can ship something magical in a hackathon timeframe.</p>
  </div>
</section>

<!-- 1 -->
<section class="sec">
  <div class="sec-head"><div class="sec-num">1</div><h2>The problem we're solving</h2></div>
  <div class="sec-body">
    <p><strong>Recording is easy. Editing is the wall.</strong> For the people who make screen recordings — developers writing docs, founders making product demos, support teams, educators, creators — the work breaks down like this:</p>
    <ul>
      <li><strong>Editing takes 5–10× the recording time.</strong> Placing zooms on every click, cutting dead air, removing "ums," speeding up boring stretches, writing captions — all manual.</li>
      <li><strong>Polish requires skill.</strong> Knowing <em>when</em> to zoom, how to pace, where to cut is craft. Most people don't have it, so their recordings look amateur.</li>
      <li><strong>One recording, many needs.</strong> The same demo needs to become a short, a README GIF, a captioned social clip, a help-doc walkthrough. Today that's N separate manual edits.</li>
      <li><strong>The tools don't understand the content.</strong> Existing editors (including ours, today) don't know that at 0:42 the user clicked "Export," or that 0:10–0:18 is silence.</li>
    </ul>
    <p><strong>The result:</strong> people either ship rough, unpolished recordings, or they burn hours editing. Neither is good.</p>
  </div>
</section>

<!-- 2 -->
<section class="sec">
  <div class="sec-head"><div class="sec-num">2</div><h2>Our insight — why Quiro can win this</h2></div>
  <div class="sec-body">
    <p>Two things make Quiro uniquely positioned:</p>
    <ul>
      <li><strong>Our editor is already a clean tool API.</strong> Every edit — zoom / trim / clip / speed / audio / annotation — lives as a structured <em>region</em> in <code>window.tsx</code>. An AI agent doesn't have to simulate clicks; it calls a function that adds a region. <strong>The editing surface is the tool surface.</strong></li>
      <li><strong>We already capture the signals an AI needs to understand a recording:</strong> the <strong>transcript</strong> (whisper.cpp, already integrated), the <strong>cursor &amp; interaction stream</strong> (our native cursor monitor), and the <strong>frames themselves</strong> (sampled for a vision model).</li>
    </ul>
    <div class="callout">
      <div class="lab">The head start</div>
      <p>We are <em>~60% of the way</em> to an AI-native editor before writing any AI code. The hackathon work is the glue, not the foundation.</p>
    </div>
  </div>
</section>

<!-- 3 -->
<section class="sec">
  <div class="sec-head"><div class="sec-num">3</div><h2>The vision — "Quiro Director"</h2></div>
  <div class="sec-body">
    <p>A conversational editing agent built into the editor. The user records, then says:</p>
    <p class="pull">"Make this a punchy 60-second product demo. Zoom into every button I click, cut the dead air and my 'ums', add captions, and end on the pricing page."</p>
    <p>…and the <strong>timeline assembles itself in front of them</strong> — zoom regions snap onto clicks, dead air collapses, captions appear. Then they refine conversationally: <em>"second zoom is too aggressive," "keep my intro,"</em> and the agent adjusts. The chat panel becomes a first-class surface that can <strong>answer</strong> questions, <strong>edit</strong> the video, <strong>repurpose</strong> it, and <strong>teach</strong> the app.</p>
  </div>
</section>

<!-- 4 -->
<section class="sec">
  <div class="sec-head"><div class="sec-num">4</div><h2>The core we're building — the "Recording Brain"</h2></div>
  <div class="sec-body">
    <p>This is the real technical contribution and the thing everything else depends on. After a recording, we build <strong>one structured semantic timeline</strong> by fusing three signals:</p>
    <table>
      <thead><tr><th style="width:23%">Signal</th><th style="width:32%">Source</th><th>Gives us</th></tr></thead>
      <tbody>
        <tr><td class="win">Transcript</td><td>whisper.cpp (already integrated)</td><td>words + timestamps, silences, filler words, sentence/topic boundaries</td></tr>
        <tr><td class="win">Interaction stream</td><td>native cursor monitor (already integrated)</td><td>clicks, typing, scrolls, "user interacted here" moments</td></tr>
        <tr><td class="win">Scene understanding</td><td>sparse frame sampling → vision model</td><td>semantic labels: "settings open," "pricing page," "code editor visible"</td></tr>
      </tbody>
    </table>
    <p>Fuse these into a JSON timeline of <strong>moments</strong>, each with a time range, a description, and tags. <strong>Every AI feature becomes a query over this structure.</strong> Build it once; the rest is cheap.</p>
  </div>
</section>

<!-- 5 -->
<section class="sec">
  <div class="sec-head"><div class="sec-num">5</div><h2>What we're adding to the product (as a whole)</h2></div>
  <div class="sec-body">
    <div class="tier"><span class="tier-tag t0">Tier 0 — Foundation</span><h3>Build first</h3>
      <ul><li><strong>The Recording Brain / semantic timeline.</strong> Nothing else works without it.</li></ul>
    </div>
    <div class="tier"><span class="tier-tag t1">Tier 1 — Flagship</span><h3>The "wow"</h3>
      <ul>
        <li><strong>Conversational edit agent ("Quiro Director").</strong> Chat → tool calls → regions update live.</li>
        <li><strong>One-click auto-edit ("magic first draft").</strong> Auto silence removal, filler-word cuts, auto-zoom on clicks, speed-ramps — the instant-gratification moment.</li>
      </ul>
    </div>
    <div class="tier"><span class="tier-tag t2">Tier 2 — Moat</span><h3>Depth that makes it real</h3>
      <ul>
        <li><strong>Text-based editing.</strong> Delete a sentence in the transcript → the video cuts that span.</li>
        <li><strong>Auto-repurpose / one-to-many export.</strong> One recording → vertical short, README GIF, thread with timestamps.</li>
        <li><strong>AI voiceover &amp; translation.</strong> Clean up audio or re-voice the demo in another language with TTS + re-captioning.</li>
      </ul>
    </div>
    <div class="tier"><span class="tier-tag t3">Tier 3 — Polish</span><h3>Cheap generations off the Brain</h3>
      <ul><li>Auto chapters, title, thumbnail, callout annotations, and an in-editor "how do I…" copilot that can perform the action.</li></ul>
    </div>
  </div>
</section>

<!-- 6 -->
<section class="sec">
  <div class="sec-head"><div class="sec-num">6</div><h2>How it fits our architecture (no rewrites)</h2></div>
  <div class="sec-body">
    <ul>
      <li><strong>Tools = existing region handlers.</strong> Expose <code>window.tsx</code> handlers as a tool schema. The agent is just another caller of the same state, so the performance-critical playback path is untouched.</li>
      <li><strong>API key lives in the main process.</strong> Chat (renderer) → IPC → main calls Claude → tool calls return → renderer mutates regions. Adding the channel touches: handler, register file, <code>preload.ts</code>, and <strong>both</strong> <code>electron-env.d.ts</code> files.</li>
      <li><strong>Reuses what's there.</strong> whisper, cursor monitor, region system, media servers. New surface = chat UI + agent loop + the Brain builder.</li>
      <li><strong>Doesn't break playback.</strong> Agent edits are batch state updates, not high-frequency ones.</li>
    </ul>
  </div>
</section>

<!-- 7 -->
<section class="sec">
  <div class="sec-head"><div class="sec-num">7</div><h2>Why we're different</h2></div>
  <div class="sec-body">
    <table>
      <thead><tr><th style="width:31%"></th><th>Loom</th><th>Screen Studio</th><th class="col-quiro">Quiro (this vision)</th></tr></thead>
      <tbody>
        <tr><td class="win">Auto-zoom</td><td>partial</td><td>mechanical</td><td class="col-quiro">zooms based on what you did &amp; said</td></tr>
        <tr><td class="win">Understands content</td><td>no</td><td>no</td><td class="col-quiro">yes — transcript + interactions + vision</td></tr>
        <tr><td class="win">Edit by talking</td><td>no</td><td>no</td><td class="col-quiro">yes — conversational agent</td></tr>
        <tr><td class="win">One-click first draft</td><td>limited</td><td>no</td><td class="col-quiro">yes</td></tr>
        <tr><td class="win">Repurpose to many formats</td><td>no</td><td>no</td><td class="col-quiro">yes</td></tr>
      </tbody>
    </table>
    <p>The category has <em>auto</em> features. <strong>Nobody has an agent that understands the recording and edits it conversationally.</strong> That's the wedge.</p>
  </div>
</section>

<!-- 8 -->
<section class="sec">
  <div class="sec-head"><div class="sec-num">8</div><h2>Hackathon scope (MVP)</h2></div>
  <div class="sec-body">
    <p>Don't build all of Section 5. The winning slice:</p>
    <ul>
      <li><strong>Recording Brain</strong> — transcript + click stream + a few vision frames → moments JSON.</li>
      <li><strong>Chat agent with 3 tools</strong> — auto-zoom-on-click, silence/filler trim, captions.</li>
      <li><strong>One "magic first draft" button.</strong></li>
      <li><strong>A rehearsed 90-second live demo.</strong></li>
    </ul>
    <p>Everything else becomes "…and it also does X" in Q&amp;A. Transformation in the demo beats a long feature list.</p>
  </div>
</section>

<!-- 9 -->
<section class="sec">
  <div class="sec-head"><div class="sec-num">9</div><h2>Tech approach</h2></div>
  <div class="sec-body">
    <ul>
      <li><strong>Agent:</strong> Claude API with <strong>tool use</strong> (function calling). Tools map 1:1 to region operations.</li>
      <li><strong>Models:</strong> <code>claude-opus-4-8</code> as the planning brain; <code>claude-haiku-4-5</code> for cheap high-volume classification ("silence / filler / important?"). <strong>Stream</strong> the chat for a live feel.</li>
      <li><strong>Vision:</strong> sample ~1 frame / few seconds for scene labels (used to build the Brain, not per-frame).</li>
      <li><strong>Security:</strong> API key in main process only; never expose to renderer.</li>
    </ul>
  </div>
</section>

<!-- 10 -->
<section class="sec">
  <div class="sec-head"><div class="sec-num">10</div><h2>The demo (how we win the room)</h2></div>
  <div class="sec-body">
    <ol class="demo-steps">
      <li>Record a deliberately messy ~3-minute screencast live (pauses, "ums," idle time).</li>
      <li>Type <strong>one sentence</strong> of intent.</li>
      <li>Watch the timeline build itself: zooms snap to clicks, dead air collapses, captions appear.</li>
      <li>One conversational refinement ("make the intro shorter").</li>
      <li>Export → show the polished result.</li>
    </ol>
    <p class="pull">"Editing a screen recording takes 10× the recording time. Quiro does it while you talk."</p>
  </div>
</section>

<!-- 11 -->
<section class="sec">
  <div class="sec-head"><div class="sec-num">11</div><h2>Risks &amp; open questions</h2></div>
  <div class="sec-body">
    <ul>
      <li><strong>Latency.</strong> Build the Brain async right after recording; use Haiku for bulk classification; stream the chat.</li>
      <li><strong>Edit quality / trust.</strong> AI edits must be previewable and reversible — show the diff on the timeline; everything is an undoable region.</li>
      <li><strong>Vision cost/volume.</strong> Keep frame sampling sparse; cache scene labels in the Brain.</li>
      <li><strong>Open:</strong> Hackathon <strong>timeframe</strong>? Judging <strong>criteria / theme</strong>? Voice or text chat for v1? Online vs. any offline constraint?</li>
    </ul>
  </div>
</section>

<!-- 12 -->
<section class="sec">
  <div class="sec-head"><div class="sec-num">12</div><h2>Suggested workstreams (team split)</h2></div>
  <div class="sec-body">
    <table>
      <thead><tr><th style="width:24%">Workstream</th><th>Scope</th></tr></thead>
      <tbody>
        <tr><td class="win">A — Recording Brain</td><td>transcript + cursor/click capture + frame sampling → moments JSON</td></tr>
        <tr><td class="win">B — Agent &amp; tools</td><td>tool schema over region handlers, IPC channel, agent loop, streaming</td></tr>
        <tr><td class="win">C — Chat UI &amp; first draft</td><td>the surface users touch + the "magic first draft" button</td></tr>
        <tr><td class="win">D — Demo &amp; pitch</td><td>script, recording, slides, narrative</td></tr>
      </tbody>
    </table>
    <div class="closing">This is a living doc — edit freely and bring questions to the team sync.</div>
  </div>
</section>

</body>
</html>`;

if (process.env.EMIT_HTML) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(resolve(root, 'docs/_pdf-source.html'), html);
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'networkidle' });
await page.pdf({
  path: outPath,
  format: 'A4',
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate:
    '<div style="width:100%;font-family:Segoe UI,Arial,sans-serif;font-size:8px;color:#9aa0a6;padding:0 14mm;display:flex;justify-content:space-between;align-items:center;">' +
    '<span style="letter-spacing:.1em;text-transform:uppercase;">Quiro AI &mdash; Vision &amp; Hackathon Brief</span>' +
    '<span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
  margin: { top: '14mm', bottom: '16mm', left: '14mm', right: '14mm' },
});
await browser.close();
console.log('PDF written to ' + outPath);
