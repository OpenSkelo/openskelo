<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>OpenSkelo v0.1 — Full Technical Specification</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400;0,500;0,700&family=JetBrains+Mono:wght@400;500;600&family=Fraunces:opsz,wght@9..144,400;9..144,700;9..144,900&display=swap" rel="stylesheet"/>
  <style>
    :root {
      --bg: #0b0e14;
      --s1: #0f1420;
      --s2: #141a28;
      --s3: #1a2236;
      --border: #1e2a40;
      --bhi: #2a3a55;
      --text: #dce5f4;
      --head: #f0f4fb;
      --muted: #7a8da6;
      --dim: #4a5a72;
      --code-bg: #0d1018;
      --gold: #f5a623;
      --blue: #4d9ef6;
      --green: #3dd68c;
      --red: #f06060;
      --purple: #9d7cf4;
      --cyan: #4dc9e6;
      --orange: #e88d4d;
    }
    * { box-sizing: border-box; margin: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'DM Sans', system-ui, sans-serif;
      line-height: 1.65;
      -webkit-font-smoothing: antialiased;
    }
    .page { max-width: 960px; margin: 0 auto; padding: 40px 24px 120px; }

    /* ── Typography ── */
    h1 { font-family:'Fraunces',serif; font-size:clamp(28px,5vw,42px); font-weight:900; line-height:1.1; letter-spacing:-0.03em; color:var(--head); margin-bottom:8px; }
    h2 { font-family:'Fraunces',serif; font-size:clamp(20px,3vw,28px); font-weight:700; line-height:1.2; color:var(--head); margin:48px 0 12px; padding-top:24px; border-top:1px solid var(--border); }
    h3 { font-size:18px; font-weight:700; color:var(--head); margin:28px 0 10px; }
    h4 { font-size:15px; font-weight:700; color:var(--text); margin:18px 0 6px; }
    p { margin:10px 0; font-size:15px; }
    .lead { font-size:17px; color:var(--muted); max-width:700px; }
    .tag { font-family:'JetBrains Mono',monospace; font-size:11px; font-weight:600; letter-spacing:0.12em; text-transform:uppercase; margin-bottom:6px; }
    .toc-link { color:var(--blue); text-decoration:none; }
    .toc-link:hover { text-decoration:underline; }

    /* ── Code ── */
    .code {
      background:var(--code-bg); border:1px solid var(--border); border-radius:10px;
      padding:16px 18px; margin:12px 0;
      font-family:'JetBrains Mono',monospace; font-size:12.5px; line-height:1.7;
      overflow-x:auto; white-space:pre; color:#b8c4d8;
    }
    .code .k { color:#c792ea; }    /* keyword */
    .code .s { color:#c3e88d; }    /* string */
    .code .f { color:#82aaff; }    /* function */
    .code .t { color:#ffcb6b; }    /* type */
    .code .n { color:#f78c6c; }    /* number */
    .code .c { color:#546e7a; }    /* comment */
    .code .p { color:#89ddff; }    /* punctuation */
    code {
      font-family:'JetBrains Mono',monospace; font-size:12.5px;
      background:var(--s2); border:1px solid var(--border);
      padding:1px 6px; border-radius:4px; color:var(--cyan);
    }

    /* ── Cards ── */
    .card { background:var(--s1); border:1px solid var(--border); border-radius:14px; padding:22px; margin:14px 0; }
    .scard { background:var(--s2); border:1px solid var(--border); border-radius:10px; padding:16px; margin:10px 0; }

    /* ── Tables ── */
    table { width:100%; border-collapse:collapse; font-size:13px; margin:12px 0; }
    th, td { padding:8px 12px; text-align:left; border-bottom:1px solid var(--border); }
    th { color:var(--muted); font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.08em; background:var(--s2); }
    td { color:var(--text); }
    td code { font-size:12px; }
    tr:last-child td { border-bottom:none; }

    /* ── Colored blocks ── */
    .pill { display:inline-block; padding:2px 10px; border-radius:999px; font-size:11px; font-weight:700; margin:2px 4px 2px 0; }
    .p-gold { background:rgba(245,166,35,0.12); border:1px solid rgba(245,166,35,0.25); color:var(--gold); }
    .p-blue { background:rgba(77,158,246,0.12); border:1px solid rgba(77,158,246,0.25); color:var(--blue); }
    .p-green { background:rgba(61,214,140,0.12); border:1px solid rgba(61,214,140,0.25); color:var(--green); }
    .p-red { background:rgba(240,96,96,0.12); border:1px solid rgba(240,96,96,0.25); color:var(--red); }
    .p-purple { background:rgba(157,124,244,0.12); border:1px solid rgba(157,124,244,0.25); color:var(--purple); }
    .p-cyan { background:rgba(77,201,230,0.12); border:1px solid rgba(77,201,230,0.25); color:var(--cyan); }
    .p-orange { background:rgba(232,141,77,0.12); border:1px solid rgba(232,141,77,0.25); color:var(--orange); }

    /* ── Info blocks ── */
    .note { background:rgba(77,158,246,0.06); border:1px solid rgba(77,158,246,0.15); border-radius:10px; padding:14px 16px; margin:12px 0; font-size:14px; }
    .warn { background:rgba(245,166,35,0.06); border:1px solid rgba(245,166,35,0.15); border-radius:10px; padding:14px 16px; margin:12px 0; font-size:14px; }
    .crit { background:rgba(240,96,96,0.06); border:1px solid rgba(240,96,96,0.15); border-radius:10px; padding:14px 16px; margin:12px 0; font-size:14px; }

    /* ── Grid ── */
    .g2 { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:12px; }
    .g3 { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:12px; }

    /* ── TOC ── */
    .toc { background:var(--s1); border:1px solid var(--border); border-radius:14px; padding:22px 28px; margin:20px 0; }
    .toc ol { padding-left:20px; }
    .toc li { margin:5px 0; font-size:14px; }
    .toc li a { color:var(--blue); text-decoration:none; }
    .toc li a:hover { text-decoration:underline; }

    @media (max-width:700px) { .g2 { grid-template-columns:1fr; } }
  </style>
</head>
<body>
<div class="page">

<!-- ═══════════════════════════════════════════════════════ -->
<!-- HEADER -->
<!-- ═══════════════════════════════════════════════════════ -->
<div style="margin-bottom:32px;">
  <div class="tag" style="color:var(--gold);">Technical Specification v0.1</div>
  <h1>OpenSkelo — Full Build Spec</h1>
  <p class="lead">Orchestration layer for AI tools. Queue + Gates + Adapters. Three npm packages. Everything needed to build from zero to ship.</p>
  <p style="color:var(--dim);font-size:13px;margin-top:8px;">Last updated: February 2026 · Status: Pre-build · License: MIT</p>
</div>

<!-- ═══════════════════════════════════════════════════════ -->
<!-- TOC -->
<!-- ═══════════════════════════════════════════════════════ -->
<div class="toc">
  <h3 style="margin-top:0;">Table of Contents</h3>
  <ol>
    <li><a href="#overview">Architecture Overview</a></li>
    <li><a href="#monorepo">Monorepo Structure</a></li>
    <li><a href="#pkg-gates">Package 1: @openskelo/gates</a></li>
    <li><a href="#pkg-queue">Package 2: @openskelo/queue</a></li>
    <li><a href="#pkg-adapters">Package 3: @openskelo/adapters</a></li>
    <li><a href="#config">Configuration Format</a></li>
    <li><a href="#api">REST API Surface</a></li>
    <li><a href="#state-machine">State Machine</a></li>
    <li><a href="#failure-modes">Failure Modes &amp; Recovery</a></li>
    <li><a href="#pipelines">Multi-Step Pipelines</a></li>
    <li><a href="#tiered-gating">Tiered Gating (Agent Wrapping)</a></li>
    <li><a href="#dashboard">Dashboard</a></li>
    <li><a href="#security">Security &amp; Limits</a></li>
    <li><a href="#testing">Testing Strategy</a></li>
    <li><a href="#dependencies">Dependencies</a></li>
    <li><a href="#build-plan">Build Plan &amp; Timeline</a></li>
  </ol>
</div>

<!-- ═══════════════════════════════════════════════════════ -->
<!-- 1. ARCHITECTURE OVERVIEW -->
<!-- ═══════════════════════════════════════════════════════ -->
<h2 id="overview">1. Architecture Overview</h2>

<p>OpenSkelo is three packages that work together or independently. It does not execute AI work — it orchestrates, verifies, and manages it.</p>

<div class="card">
<div class="code"><span class="c">┌─────────────────────────────────────────────────────────┐</span>
<span class="c">│                     YOUR APPLICATION                     │</span>
<span class="c">│  (OpenClaw bot, CLI tool, web app, script, anything)     │</span>
<span class="c">└────────────────────────┬────────────────────────────────┘</span>
                         │ POST /tasks
                         ▼
<span class="c">┌─────────────────────────────────────────────────────────┐</span>
<span class="c">│</span>  <span class="t">@openskelo/queue</span>                                       <span class="c">│</span>
<span class="c">│</span>  ┌──────────┐ ┌────────────┐ ┌──────────┐ ┌──────────┐ <span class="c">│</span>
<span class="c">│</span>  │ <span class="f">Priority</span> │ │ <span class="f">Dispatcher</span> │ │ <span class="f">Watchdog</span> │ │ <span class="f">Audit</span>    │ <span class="c">│</span>
<span class="c">│</span>  │ <span class="f">Queue</span>    │ │ <span class="f">+ Claims</span>  │ │ <span class="f">+ Leases</span> │ │ <span class="f">Log</span>      │ <span class="c">│</span>
<span class="c">│</span>  └──────────┘ └─────┬──────┘ └──────────┘ └──────────┘ <span class="c">│</span>
<span class="c">│</span>                      │ dispatch                          <span class="c">│</span>
<span class="c">└──────────────────────┼──────────────────────────────────┘</span>
                       ▼
<span class="c">┌─────────────────────────────────────────────────────────┐</span>
<span class="c">│</span>  <span class="t">@openskelo/adapters</span>                                    <span class="c">│</span>
<span class="c">│</span>  ┌────────────┐ ┌───────┐ ┌───────┐ ┌─────────┐        <span class="c">│</span>
<span class="c">│</span>  │ <span class="f">claude-code</span>│ │ <span class="f">codex</span> │ │ <span class="f">aider</span> │ │ <span class="f">raw-api</span> │ ...    <span class="c">│</span>
<span class="c">│</span>  └─────┬──────┘ └───┬───┘ └───┬───┘ └────┬────┘        <span class="c">│</span>
<span class="c">└────────┼────────────┼─────────┼──────────┼─────────────┘</span>
         ▼            ▼         ▼          ▼
  <span class="s">Claude Code</span>    <span class="s">Codex CLI</span>   <span class="s">Aider</span>    <span class="s">HTTP API</span>  <span class="c">(external tools)</span>
         │            │         │          │
         └────────────┴─────────┴──────────┘
                       │ output
                       ▼
<span class="c">┌─────────────────────────────────────────────────────────┐</span>
<span class="c">│</span>  <span class="t">@openskelo/gates</span>                                       <span class="c">│</span>
<span class="c">│</span>  ┌─────────┐ ┌──────────┐ ┌───────┐ ┌───────┐ ┌──────┐ <span class="c">│</span>
<span class="c">│</span>  │ <span class="f">schema</span>  │ │ <span class="f">expression</span>│ │ <span class="f">regex</span> │ │ <span class="f">command</span>│ │ <span class="f">llm</span>  │ <span class="c">│</span>
<span class="c">│</span>  └─────────┘ └──────────┘ └───────┘ └───────┘ └──────┘ <span class="c">│</span>
<span class="c">│</span>                                                         <span class="c">│</span>
<span class="c">│</span>  <span class="f">pass</span> → REVIEW        <span class="f">fail</span> → retry with feedback         <span class="c">│</span>
<span class="c">└─────────────────────────────────────────────────────────┘</span></div>
</div>

<h3>Design Principles</h3>
<table>
  <tr><th>Principle</th><th>What it means</th></tr>
  <tr><td>Execution-agnostic</td><td>Never executes AI work directly. Dispatches to external tools via adapters.</td></tr>
  <tr><td>Database-state, not memory</td><td>All task state lives in SQLite. Survives crashes, restarts, context limits.</td></tr>
  <tr><td>Deterministic ordering</td><td>Same inputs → same dequeue order. No randomness in priority resolution.</td></tr>
  <tr><td>Structural verification</td><td>Gates check output with code, not prompts. Schema, regex, shell commands.</td></tr>
  <tr><td>Retry with feedback</td><td>Failed gates inject failure reason into retry. Each attempt is smarter.</td></tr>
  <tr><td>Zero infrastructure</td><td>SQLite file. No Redis. No Postgres. No Docker. npm install and go.</td></tr>
  <tr><td>Progressively adoptable</td><td>Use gates alone. Add queue later. Add adapters when ready. No all-or-nothing.</td></tr>
</table>

<!-- ═══════════════════════════════════════════════════════ -->
<!-- 2. MONOREPO STRUCTURE -->
<!-- ═══════════════════════════════════════════════════════ -->
<h2 id="monorepo">2. Monorepo Structure</h2>

<div class="code">openskelo/
├── packages/
│   ├── gates/                          <span class="c">← @openskelo/gates</span>
│   │   ├── src/
│   │   │   ├── index.ts                <span class="c">← gated() + createGateRunner()</span>
│   │   │   ├── types.ts                <span class="c">← all TypeScript interfaces</span>
│   │   │   ├── runner.ts               <span class="c">← gate evaluation engine</span>
│   │   │   ├── retry.ts                <span class="c">← retry-with-feedback loop</span>
│   │   │   ├── gates/
│   │   │   │   ├── json-schema.ts      <span class="c">← Zod-based schema validation</span>
│   │   │   │   ├── expression.ts       <span class="c">← safe expression evaluator</span>
│   │   │   │   ├── regex.ts            <span class="c">← pattern matching</span>
│   │   │   │   ├── word-count.ts       <span class="c">← length bounds checking</span>
│   │   │   │   ├── command.ts          <span class="c">← shell command execution</span>
│   │   │   │   └── llm-review.ts       <span class="c">← LLM second-opinion check</span>
│   │   │   └── utils/
│   │   │       ├── safe-eval.ts        <span class="c">← sandboxed expression evaluation</span>
│   │   │       └── parse-output.ts     <span class="c">← JSON extraction from LLM output</span>
│   │   ├── __tests__/
│   │   │   ├── gates.test.ts
│   │   │   ├── runner.test.ts
│   │   │   ├── retry.test.ts
│   │   │   └── integration.test.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── README.md
│   │
│   ├── queue/                          <span class="c">← @openskelo/queue</span>
│   │   ├── src/
│   │   │   ├── index.ts                <span class="c">← createQueue() factory</span>
│   │   │   ├── types.ts                <span class="c">← Task, QueueConfig, etc.</span>
│   │   │   ├── db.ts                   <span class="c">← SQLite schema + queries</span>
│   │   │   ├── task-store.ts           <span class="c">← CRUD operations on tasks</span>
│   │   │   ├── dispatcher.ts           <span class="c">← claim-next + routing logic</span>
│   │   │   ├── state-machine.ts        <span class="c">← transition guards + validation</span>
│   │   │   ├── watchdog.ts             <span class="c">← lease expiry scanner</span>
│   │   │   ├── audit.ts                <span class="c">← append-only mutation log</span>
│   │   │   ├── config.ts               <span class="c">← YAML/JSON config loader</span>
│   │   │   └── server.ts               <span class="c">← Express REST API (optional)</span>
│   │   ├── __tests__/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── README.md
│   │
│   └── adapters/                       <span class="c">← @openskelo/adapters</span>
│       ├── src/
│       │   ├── index.ts                <span class="c">← re-exports all adapters</span>
│       │   ├── types.ts                <span class="c">← ExecutionAdapter interface</span>
│       │   ├── base.ts                 <span class="c">← BaseAdapter abstract class</span>
│       │   ├── claude-code.ts          <span class="c">← ~120 lines</span>
│       │   ├── codex.ts                <span class="c">← ~90 lines</span>
│       │   ├── aider.ts                <span class="c">← ~90 lines</span>
│       │   ├── raw-api.ts              <span class="c">← ~70 lines</span>
│       │   └── shell.ts                <span class="c">← ~60 lines</span>
│       ├── __tests__/
│       ├── package.json
│       ├── tsconfig.json
│       └── README.md
│
├── examples/
│   ├── standalone-gates/               <span class="c">← gates only, no queue</span>
│   ├── basic-queue/                    <span class="c">← queue + one adapter</span>
│   ├── full-pipeline/                  <span class="c">← multi-step with all packages</span>
│   └── openclaw-integration/           <span class="c">← OpenClaw bot → queue → Claude Code</span>
│
├── package.json                        <span class="c">← npm workspaces root</span>
├── tsconfig.base.json                  <span class="c">← shared TS config</span>
├── vitest.config.ts                    <span class="c">← test runner config</span>
└── README.md</div>

<h3>Package Dependencies</h3>
<div class="code"><span class="c">@openskelo/gates</span>     → depends on: <span class="s">zod</span> (only external dep)
<span class="c">@openskelo/adapters</span>  → depends on: <span class="s">@openskelo/gates</span>
<span class="c">@openskelo/queue</span>     → depends on: <span class="s">@openskelo/gates</span>, <span class="s">@openskelo/adapters</span>, <span class="s">better-sqlite3</span>, <span class="s">express</span> (optional)</div>


<!-- ═══════════════════════════════════════════════════════ -->
<!-- 3. PACKAGE 1: GATES -->
<!-- ═══════════════════════════════════════════════════════ -->
<h2 id="pkg-gates">3. Package 1: @openskelo/gates</h2>

<div class="tag" style="color:var(--green);">Ships first · Zero deps beyond Zod · Works standalone</div>

<h3>3.1 Core Interface: <code>gated()</code></h3>

<div class="code"><span class="k">import</span> { <span class="f">gated</span> } <span class="k">from</span> <span class="s">'@openskelo/gates'</span>;

<span class="c">// Wrap any async function that returns AI output</span>
<span class="k">const</span> result = <span class="k">await</span> <span class="f">gated</span>(
  <span class="c">// The producer function — your existing LLM call</span>
  <span class="k">async</span> (context?: <span class="t">RetryContext</span>) => {
    <span class="k">const</span> messages = [{ role: <span class="s">'user'</span>, content: prompt }];
    <span class="c">// On retry, context.feedback contains failure reasons</span>
    <span class="k">if</span> (context?.feedback) {
      messages.push({ role: <span class="s">'user'</span>, content: context.feedback });
    }
    <span class="k">return</span> anthropic.messages.<span class="f">create</span>({ model, messages });
  },
  <span class="c">// Gate configuration</span>
  {
    gates: [
      { type: <span class="s">'json_schema'</span>, schema: { required: [<span class="s">'price'</span>, <span class="s">'analysis'</span>] } },
      { type: <span class="s">'expression'</span>, expr: <span class="s">'price > 0 && price < 10000'</span> },
      { type: <span class="s">'word_count'</span>, min: <span class="n">50</span>, max: <span class="n">2000</span> },
    ],
    retry: { max: <span class="n">3</span>, feedback: <span class="k">true</span> },
    extract: <span class="s">'json'</span>,  <span class="c">// auto-parse JSON from LLM text output</span>
  }
);

<span class="c">// result.data    → verified, parsed output</span>
<span class="c">// result.raw     → original LLM response</span>
<span class="c">// result.attempts → number of attempts used</span>
<span class="c">// result.gates   → per-gate pass/fail details</span></div>

<h3>3.2 TypeScript Interfaces</h3>

<div class="code"><span class="c">// ═══ Core Types ═══</span>

<span class="k">interface</span> <span class="t">GatedOptions</span>&lt;<span class="t">T</span>&gt; {
  gates: <span class="t">GateDefinition</span>[];
  retry?: <span class="t">RetryConfig</span>;
  extract?: <span class="s">'json'</span> | <span class="s">'text'</span> | <span class="s">'auto'</span> | (raw: <span class="k">any</span>) => <span class="t">T</span>;  <span class="c">// output parser</span>
  timeout?: <span class="k">number</span>;    <span class="c">// ms per attempt (default: 120000)</span>
  onAttempt?: (attempt: <span class="t">AttemptEvent</span>) => <span class="k">void</span>;  <span class="c">// progress callback</span>
}

<span class="k">interface</span> <span class="t">GatedResult</span>&lt;<span class="t">T</span>&gt; {
  data: <span class="t">T</span>;                       <span class="c">// verified output</span>
  raw: <span class="k">any</span>;                      <span class="c">// original LLM response</span>
  attempts: <span class="k">number</span>;              <span class="c">// how many attempts used</span>
  gates: <span class="t">GateResult</span>[];           <span class="c">// per-gate results from final attempt</span>
  history: <span class="t">AttemptRecord</span>[];      <span class="c">// all attempts with their gate results</span>
  duration_ms: <span class="k">number</span>;           <span class="c">// total wall time</span>
}

<span class="k">interface</span> <span class="t">RetryConfig</span> {
  max: <span class="k">number</span>;           <span class="c">// max retries (1-10, default: 3)</span>
  feedback: <span class="k">boolean</span>;     <span class="c">// inject failure reasons into retry (default: true)</span>
  delay_ms?: <span class="k">number</span>;     <span class="c">// delay between retries (default: 0)</span>
  backoff?: <span class="k">boolean</span>;     <span class="c">// exponential backoff (default: false)</span>
}

<span class="k">interface</span> <span class="t">RetryContext</span> {
  attempt: <span class="k">number</span>;       <span class="c">// current attempt (1-indexed)</span>
  feedback: <span class="k">string</span>;      <span class="c">// compiled failure reasons from last attempt</span>
  failures: <span class="t">GateResult</span>[]; <span class="c">// individual gate failures</span>
}

<span class="c">// ═══ Gate Definitions ═══</span>

<span class="k">type</span> <span class="t">GateDefinition</span> =
  | <span class="t">JsonSchemaGate</span>
  | <span class="t">ExpressionGate</span>
  | <span class="t">RegexGate</span>
  | <span class="t">WordCountGate</span>
  | <span class="t">CommandGate</span>
  | <span class="t">LlmReviewGate</span>
  | <span class="t">CustomGate</span>;

<span class="k">interface</span> <span class="t">JsonSchemaGate</span> {
  type: <span class="s">'json_schema'</span>;
  schema: <span class="t">ZodSchema</span> | { required?: <span class="k">string</span>[]; properties?: <span class="t">Record</span>&lt;<span class="k">string</span>, <span class="k">any</span>&gt; };
  name?: <span class="k">string</span>;       <span class="c">// human label for error messages</span>
}

<span class="k">interface</span> <span class="t">ExpressionGate</span> {
  type: <span class="s">'expression'</span>;
  expr: <span class="k">string</span>;        <span class="c">// JS expression evaluated against output data</span>
  name?: <span class="k">string</span>;
}

<span class="k">interface</span> <span class="t">RegexGate</span> {
  type: <span class="s">'regex'</span>;
  pattern: <span class="k">string</span>;     <span class="c">// regex pattern to match against output text</span>
  flags?: <span class="k">string</span>;      <span class="c">// regex flags (default: '')</span>
  invert?: <span class="k">boolean</span>;    <span class="c">// true = FAIL if pattern matches (blocklist)</span>
  name?: <span class="k">string</span>;
}

<span class="k">interface</span> <span class="t">WordCountGate</span> {
  type: <span class="s">'word_count'</span>;
  min?: <span class="k">number</span>;        <span class="c">// minimum word count</span>
  max?: <span class="k">number</span>;        <span class="c">// maximum word count</span>
  name?: <span class="k">string</span>;
}

<span class="k">interface</span> <span class="t">CommandGate</span> {
  type: <span class="s">'command'</span>;
  run: <span class="k">string</span>;         <span class="c">// shell command to execute</span>
  expect_exit?: <span class="k">number</span>; <span class="c">// expected exit code (default: 0)</span>
  cwd?: <span class="k">string</span>;        <span class="c">// working directory</span>
  timeout_ms?: <span class="k">number</span>; <span class="c">// command timeout (default: 60000)</span>
  env?: <span class="t">Record</span>&lt;<span class="k">string</span>, <span class="k">string</span>&gt;; <span class="c">// additional env vars</span>
  name?: <span class="k">string</span>;
}

<span class="k">interface</span> <span class="t">LlmReviewGate</span> {
  type: <span class="s">'llm_review'</span>;
  criteria: <span class="k">string</span>[];   <span class="c">// list of criteria the LLM judges against</span>
  provider?: <span class="t">LlmProvider</span>; <span class="c">// which LLM to use for review</span>
  model?: <span class="k">string</span>;       <span class="c">// model name (default: cheapest available)</span>
  threshold?: <span class="k">number</span>;   <span class="c">// pass threshold 0-1 (default: 0.8)</span>
  name?: <span class="k">string</span>;
}

<span class="k">interface</span> <span class="t">CustomGate</span> {
  type: <span class="s">'custom'</span>;
  fn: (data: <span class="k">any</span>, raw: <span class="k">any</span>) => <span class="t">Promise</span>&lt;<span class="t">GateResult</span>&gt; | <span class="t">GateResult</span>;
  name?: <span class="k">string</span>;
}

<span class="c">// ═══ Gate Results ═══</span>

<span class="k">interface</span> <span class="t">GateResult</span> {
  gate: <span class="k">string</span>;         <span class="c">// gate name or type</span>
  passed: <span class="k">boolean</span>;
  reason?: <span class="k">string</span>;      <span class="c">// human-readable failure reason</span>
  details?: <span class="k">any</span>;        <span class="c">// structured failure data (e.g., Zod errors)</span>
  duration_ms: <span class="k">number</span>;  <span class="c">// evaluation time</span>
  cost?: <span class="k">number</span>;        <span class="c">// $ cost (for llm_review gates)</span>
}

<span class="k">interface</span> <span class="t">AttemptRecord</span> {
  attempt: <span class="k">number</span>;
  gates: <span class="t">GateResult</span>[];
  passed: <span class="k">boolean</span>;
  feedback_sent?: <span class="k">string</span>;
  duration_ms: <span class="k">number</span>;
}</div>

<h3>3.3 Gate Type Specifications</h3>

<table>
  <tr><th>Gate</th><th>Cost</th><th>Speed</th><th>What It Checks</th><th>Output on Fail</th></tr>
  <tr><td><code>json_schema</code></td><td>Free</td><td>&lt;1ms</td><td>Required fields exist, types match, Zod schema validates</td><td>Zod error path + expected type</td></tr>
  <tr><td><code>expression</code></td><td>Free</td><td>&lt;1ms</td><td>JS expression evaluates to truthy against output data</td><td>Expression + actual values</td></tr>
  <tr><td><code>regex</code></td><td>Free</td><td>&lt;1ms</td><td>Pattern matches (or doesn't match if inverted) output text</td><td>Pattern + match/no-match</td></tr>
  <tr><td><code>word_count</code></td><td>Free</td><td>&lt;1ms</td><td>Word count within min/max bounds</td><td>Actual count + bounds</td></tr>
  <tr><td><code>command</code></td><td>Free</td><td>Varies</td><td>Shell command exits with expected code</td><td>Exit code + stderr</td></tr>
  <tr><td><code>llm_review</code></td><td>~$0.001-0.01</td><td>1-5s</td><td>Second LLM judges output against criteria list</td><td>Per-criterion pass/fail + reasoning</td></tr>
  <tr><td><code>custom</code></td><td>User-defined</td><td>User-defined</td><td>Any async function returning GateResult</td><td>User-defined</td></tr>
</table>

<h3>3.4 Expression Gate — Safe Evaluation</h3>

<div class="warn">
  <strong>Security:</strong> Expressions are evaluated in a sandboxed context. No access to <code>process</code>, <code>require</code>, <code>import</code>, <code>eval</code>, <code>Function</code>, filesystem, or network. Only the output data object is in scope. Uses a whitelist approach — only property access, arithmetic, comparison, and logical operators are allowed.
</div>

<div class="code"><span class="c">// Expression gate evaluation context:</span>
<span class="c">// The output data object is spread into scope</span>

<span class="c">// If output data is: { price: 42.50, sources: ["a", "b"], rating: "buy" }</span>

<span class="s">"price > 0 && price < 10000"</span>               <span class="c">// ✓ valid</span>
<span class="s">"sources.length >= 2"</span>                        <span class="c">// ✓ valid</span>
<span class="s">"rating === 'buy' || rating === 'sell'"</span>      <span class="c">// ✓ valid</span>
<span class="s">"price * 1.1 < 50"</span>                           <span class="c">// ✓ valid (arithmetic)</span>

<span class="s">"process.exit(1)"</span>                             <span class="c">// ✗ blocked</span>
<span class="s">"require('fs').readFileSync('/etc/passwd')"</span>  <span class="c">// ✗ blocked</span>
<span class="s">"fetch('http://evil.com')"</span>                    <span class="c">// ✗ blocked</span></div>

<h3>3.5 LLM Review Gate — Provider Interface</h3>

<div class="code"><span class="k">interface</span> <span class="t">LlmProvider</span> {
  name: <span class="k">string</span>;
  <span class="f">review</span>(input: <span class="t">LlmReviewInput</span>): <span class="t">Promise</span>&lt;<span class="t">LlmReviewOutput</span>&gt;;
}

<span class="k">interface</span> <span class="t">LlmReviewInput</span> {
  output: <span class="k">string</span>;              <span class="c">// the AI output being reviewed</span>
  criteria: <span class="k">string</span>[];          <span class="c">// criteria to judge against</span>
  original_prompt?: <span class="k">string</span>;    <span class="c">// optional: the original task prompt</span>
}

<span class="k">interface</span> <span class="t">LlmReviewOutput</span> {
  passed: <span class="k">boolean</span>;
  score: <span class="k">number</span>;               <span class="c">// 0-1 overall score</span>
  criteria_results: {
    criterion: <span class="k">string</span>;
    passed: <span class="k">boolean</span>;
    reasoning: <span class="k">string</span>;
  }[];
  cost: <span class="k">number</span>;                <span class="c">// $ cost of this review call</span>
}

<span class="c">// Built-in providers (user can also pass custom):</span>
<span class="c">// - AnthropicProvider: uses Claude Haiku via API key</span>
<span class="c">// - OpenAIProvider: uses GPT-4o-mini via API key</span>
<span class="c">// - ProviderFromEnv: auto-detects from ANTHROPIC_API_KEY / OPENAI_API_KEY</span></div>

<h3>3.6 Retry-With-Feedback Engine</h3>

<div class="code"><span class="c">// Internal retry loop pseudocode:</span>

<span class="k">for</span> (attempt = <span class="n">1</span>; attempt <= maxRetries; attempt++) {
  <span class="c">// 1. Call producer function</span>
  <span class="k">const</span> raw = <span class="k">await</span> producer(attempt === <span class="n">1</span> ? <span class="k">undefined</span> : {
    attempt,
    feedback: compileFeedback(lastFailures),
    failures: lastFailures,
  });

  <span class="c">// 2. Extract structured data from raw output</span>
  <span class="k">const</span> data = extract(raw);

  <span class="c">// 3. Run all gates in sequence</span>
  <span class="k">const</span> gateResults = [];
  <span class="k">for</span> (<span class="k">const</span> gate <span class="k">of</span> gates) {
    <span class="k">const</span> result = <span class="k">await</span> <span class="f">evaluateGate</span>(gate, data, raw);
    gateResults.<span class="f">push</span>(result);
    <span class="c">// Gates run in sequence — first failure short-circuits</span>
    <span class="c">// (configurable: can also run all gates regardless)</span>
    <span class="k">if</span> (!result.passed && options.shortCircuit !== <span class="k">false</span>) <span class="k">break</span>;
  }

  <span class="c">// 4. All passed? Return success</span>
  <span class="k">if</span> (gateResults.<span class="f">every</span>(g => g.passed)) {
    <span class="k">return</span> { data, raw, attempts: attempt, gates: gateResults, history };
  }

  <span class="c">// 5. Failed — store for retry feedback</span>
  lastFailures = gateResults.<span class="f">filter</span>(g => !g.passed);
  history.<span class="f">push</span>({ attempt, gates: gateResults, passed: <span class="k">false</span> });
}

<span class="c">// 6. All retries exhausted — throw GateExhaustionError</span>
<span class="k">throw</span> <span class="k">new</span> <span class="t">GateExhaustionError</span>(history);</div>

<h3>3.7 Feedback Compilation</h3>

<div class="code"><span class="c">// Feedback string sent to producer on retry:</span>

<span class="s">`Your previous output failed verification.

Attempt 2 of 3. Failures:

1. [json_schema] Missing required field: "sources"
   Expected: object with required fields ["summary", "sources", "confidence"]
   Got: object with keys ["summary", "confidence"]

2. [expression] Expression failed: sources.length >= 3
   Reason: sources is undefined

Please fix these issues and try again. Keep all other content that was correct.`</span></div>

<h3>3.8 Advanced: <code>createGateRunner()</code></h3>

<div class="code"><span class="c">// For users who want gates without the retry loop</span>
<span class="c">// (e.g., queue uses this internally for transition guards)</span>

<span class="k">import</span> { <span class="f">createGateRunner</span> } <span class="k">from</span> <span class="s">'@openskelo/gates'</span>;

<span class="k">const</span> runner = <span class="f">createGateRunner</span>([
  { type: <span class="s">'json_schema'</span>, schema: mySchema },
  { type: <span class="s">'expression'</span>, expr: <span class="s">'status !== "error"'</span> },
]);

<span class="k">const</span> results: <span class="t">GateResult</span>[] = <span class="k">await</span> runner.<span class="f">evaluate</span>(data);
<span class="c">// returns array of gate results — no retry, no feedback</span>
<span class="c">// caller decides what to do with failures</span></div>


<!-- ═══════════════════════════════════════════════════════ -->
<!-- 4. PACKAGE 2: QUEUE -->
<!-- ═══════════════════════════════════════════════════════ -->
<h2 id="pkg-queue">4. Package 2: @openskelo/queue</h2>

<div class="tag" style="color:var(--gold);">SQLite-backed · REST API · Dashboard</div>

<h3>4.1 Task Data Model</h3>

<div class="code"><span class="k">interface</span> <span class="t">Task</span> {
  <span class="c">// ─── Identity ───</span>
  id: <span class="k">string</span>;                     <span class="c">// TASK-{ulid} auto-generated</span>
  type: <span class="k">string</span>;                   <span class="c">// "coding" | "research" | "writing" | any string</span>
  status: <span class="t">TaskStatus</span>;             <span class="c">// current state</span>

  <span class="c">// ─── Priority & Ordering ───</span>
  priority: <span class="k">number</span>;               <span class="c">// 0=P0(urgent) 1=P1 2=P2 3=P3(low)</span>
  manual_rank: <span class="k">number</span> | <span class="k">null</span>;     <span class="c">// overrides priority sort when set</span>

  <span class="c">// ─── Work Description ───</span>
  summary: <span class="k">string</span>;                <span class="c">// human-readable task summary</span>
  prompt: <span class="k">string</span>;                 <span class="c">// full prompt/instructions for execution tool</span>
  acceptance_criteria: <span class="k">string</span>[];  <span class="c">// what "good" looks like</span>
  definition_of_done: <span class="k">string</span>;     <span class="c">// single sentence: when is this DONE?</span>

  <span class="c">// ─── Execution ───</span>
  backend: <span class="k">string</span>;                <span class="c">// adapter name: "claude-code" | "codex" | "raw-api" | etc</span>
  backend_config?: <span class="t">Record</span>&lt;<span class="k">string</span>, <span class="k">any</span>&gt;; <span class="c">// per-task adapter overrides</span>

  <span class="c">// ─── Results ───</span>
  result?: <span class="t">TaskResult</span>;            <span class="c">// set when execution completes</span>
  evidence_ref?: <span class="k">string</span>;          <span class="c">// diff path, file URI, artifact URI</span>

  <span class="c">// ─── Lease (ownership) ───</span>
  lease_owner: <span class="k">string</span> | <span class="k">null</span>;     <span class="c">// which adapter instance holds the lease</span>
  lease_expires_at: <span class="k">string</span> | <span class="k">null</span>; <span class="c">// ISO datetime</span>

  <span class="c">// ─── Retry / Bounce tracking ───</span>
  attempt_count: <span class="k">number</span>;          <span class="c">// auto-retry count (gate failures)</span>
  bounce_count: <span class="k">number</span>;           <span class="c">// human review rejection count</span>
  last_error: <span class="k">string</span> | <span class="k">null</span>;      <span class="c">// most recent failure reason</span>
  feedback_history: <span class="t">Feedback</span>[];   <span class="c">// all bounce feedback entries</span>

  <span class="c">// ─── Dependencies (for pipelines) ───</span>
  depends_on: <span class="k">string</span>[];           <span class="c">// task IDs that must be DONE before this can start</span>
  pipeline_id?: <span class="k">string</span>;          <span class="c">// groups related tasks</span>
  pipeline_step?: <span class="k">number</span>;        <span class="c">// ordering within pipeline</span>

  <span class="c">// ─── Gates ───</span>
  gates?: <span class="t">GateDefinition</span>[];       <span class="c">// per-task gate overrides (falls back to config)</span>

  <span class="c">// ─── Metadata ───</span>
  metadata: <span class="t">Record</span>&lt;<span class="k">string</span>, <span class="k">any</span>&gt;; <span class="c">// freeform: repo path, file list, tags, etc.</span>
  created_by?: <span class="k">string</span>;           <span class="c">// who/what created this task</span>
  created_at: <span class="k">string</span>;             <span class="c">// ISO datetime</span>
  updated_at: <span class="k">string</span>;             <span class="c">// ISO datetime</span>
}

<span class="k">type</span> <span class="t">TaskStatus</span> = <span class="s">'PENDING'</span> | <span class="s">'IN_PROGRESS'</span> | <span class="s">'REVIEW'</span> | <span class="s">'DONE'</span> | <span class="s">'BLOCKED'</span>;

<span class="k">interface</span> <span class="t">TaskResult</span> {
  output: <span class="k">string</span>;                <span class="c">// text output from execution tool</span>
  structured?: <span class="k">any</span>;              <span class="c">// parsed structured data (if applicable)</span>
  files_changed?: <span class="k">string</span>[];      <span class="c">// list of files modified</span>
  diff?: <span class="k">string</span>;                 <span class="c">// git diff or equivalent</span>
  exit_code: <span class="k">number</span>;             <span class="c">// tool exit code</span>
  duration_ms: <span class="k">number</span>;           <span class="c">// execution time</span>
  cost?: <span class="k">number</span>;                 <span class="c">// $ cost of this execution</span>
  gate_results?: <span class="t">GateResult</span>[];   <span class="c">// gate evaluation details</span>
}

<span class="k">interface</span> <span class="t">Feedback</span> {
  what: <span class="k">string</span>;                  <span class="c">// what's wrong</span>
  where: <span class="k">string</span>;                 <span class="c">// where the issue is</span>
  fix: <span class="k">string</span>;                   <span class="c">// how to fix it</span>
  by: <span class="k">string</span>;                    <span class="c">// who gave this feedback</span>
  at: <span class="k">string</span>;                    <span class="c">// ISO datetime</span>
}</div>

<h3>4.2 SQLite Schema</h3>

<div class="code"><span class="c">-- Core tasks table</span>
<span class="k">CREATE TABLE</span> tasks (
  id              <span class="t">TEXT</span> PRIMARY KEY,
  type            <span class="t">TEXT</span> NOT NULL,
  status          <span class="t">TEXT</span> NOT NULL DEFAULT <span class="s">'PENDING'</span>,
  priority        <span class="t">INTEGER</span> NOT NULL DEFAULT <span class="n">2</span>,
  manual_rank     <span class="t">INTEGER</span>,
  summary         <span class="t">TEXT</span> NOT NULL,
  prompt          <span class="t">TEXT</span> NOT NULL,
  acceptance_criteria <span class="t">TEXT</span>,    <span class="c">-- JSON array</span>
  definition_of_done  <span class="t">TEXT</span>,
  backend         <span class="t">TEXT</span> NOT NULL,
  backend_config  <span class="t">TEXT</span>,          <span class="c">-- JSON</span>
  result          <span class="t">TEXT</span>,          <span class="c">-- JSON TaskResult</span>
  evidence_ref    <span class="t">TEXT</span>,
  lease_owner     <span class="t">TEXT</span>,
  lease_expires_at <span class="t">TEXT</span>,
  attempt_count   <span class="t">INTEGER</span> NOT NULL DEFAULT <span class="n">0</span>,
  bounce_count    <span class="t">INTEGER</span> NOT NULL DEFAULT <span class="n">0</span>,
  last_error      <span class="t">TEXT</span>,
  feedback_history <span class="t">TEXT</span>,       <span class="c">-- JSON Feedback[]</span>
  depends_on      <span class="t">TEXT</span>,          <span class="c">-- JSON string[]</span>
  pipeline_id     <span class="t">TEXT</span>,
  pipeline_step   <span class="t">INTEGER</span>,
  gates           <span class="t">TEXT</span>,          <span class="c">-- JSON GateDefinition[]</span>
  metadata        <span class="t">TEXT</span> DEFAULT <span class="s">'{}'</span>,
  created_by      <span class="t">TEXT</span>,
  created_at      <span class="t">TEXT</span> NOT NULL DEFAULT (datetime(<span class="s">'now'</span>)),
  updated_at      <span class="t">TEXT</span> NOT NULL DEFAULT (datetime(<span class="s">'now'</span>))
);

<span class="c">-- Deterministic ordering index</span>
<span class="k">CREATE INDEX</span> idx_tasks_queue_order
  <span class="k">ON</span> tasks (status, manual_rank, priority, created_at)
  <span class="k">WHERE</span> status = <span class="s">'PENDING'</span>;

<span class="c">-- Lease expiry index (for watchdog)</span>
<span class="k">CREATE INDEX</span> idx_tasks_lease_expiry
  <span class="k">ON</span> tasks (lease_expires_at)
  <span class="k">WHERE</span> status = <span class="s">'IN_PROGRESS'</span> AND lease_expires_at IS NOT NULL;

<span class="c">-- Pipeline grouping</span>
<span class="k">CREATE INDEX</span> idx_tasks_pipeline
  <span class="k">ON</span> tasks (pipeline_id, pipeline_step)
  <span class="k">WHERE</span> pipeline_id IS NOT NULL;

<span class="c">-- Append-only audit log</span>
<span class="k">CREATE TABLE</span> audit_log (
  id         <span class="t">INTEGER</span> PRIMARY KEY AUTOINCREMENT,
  task_id    <span class="t">TEXT</span> NOT NULL,
  action     <span class="t">TEXT</span> NOT NULL,     <span class="c">-- 'create','claim','release','transition','heartbeat','reorder'</span>
  from_state <span class="t">TEXT</span>,
  to_state   <span class="t">TEXT</span>,
  actor      <span class="t">TEXT</span>,              <span class="c">-- who/what triggered</span>
  details    <span class="t">TEXT</span>,              <span class="c">-- JSON payload</span>
  created_at <span class="t">TEXT</span> NOT NULL DEFAULT (datetime(<span class="s">'now'</span>))
);

<span class="k">CREATE INDEX</span> idx_audit_task <span class="k">ON</span> audit_log (task_id, created_at);</div>

<h3>4.3 Queue Factory</h3>

<div class="code"><span class="k">import</span> { <span class="f">createQueue</span> } <span class="k">from</span> <span class="s">'@openskelo/queue'</span>;

<span class="k">const</span> queue = <span class="f">createQueue</span>({
  <span class="c">// Database</span>
  db_path: <span class="s">'./openskelo.db'</span>,         <span class="c">// SQLite file path</span>

  <span class="c">// Ordering</span>
  ordering: [<span class="s">'manual_rank'</span>, <span class="s">'priority'</span>, <span class="s">'created_at'</span>],

  <span class="c">// WIP limits per task type</span>
  wip_limits: {
    coding: <span class="n">1</span>,
    research: <span class="n">3</span>,
    writing: <span class="n">2</span>,
    default: <span class="n">1</span>,
  },

  <span class="c">// Lease config</span>
  leases: {
    ttl_seconds: <span class="n">1200</span>,              <span class="c">// 20 minutes</span>
    heartbeat_interval_seconds: <span class="n">60</span>, <span class="c">// signal every 60s</span>
    grace_period_seconds: <span class="n">30</span>,       <span class="c">// buffer before watchdog acts</span>
  },

  <span class="c">// Recovery</span>
  recovery: {
    on_lease_expire: <span class="s">'requeue'</span>,     <span class="c">// 'requeue' | 'block'</span>
    max_attempts: <span class="n">3</span>,               <span class="c">// auto-retries before BLOCKED</span>
    max_bounces: <span class="n">5</span>,                <span class="c">// human rejections before BLOCKED</span>
  },

  <span class="c">// Adapters</span>
  adapters: [claudeCodeAdapter, codexAdapter, rawApiAdapter],

  <span class="c">// Default gates per task type</span>
  gates: {
    coding: {
      post: [
        { type: <span class="s">'command'</span>, run: <span class="s">'npm test'</span>, expect_exit: <span class="n">0</span> },
        { type: <span class="s">'expression'</span>, expr: <span class="s">'files_changed.length < 20'</span> },
      ]
    },
    research: {
      post: [
        { type: <span class="s">'json_schema'</span>, schema: { required: [<span class="s">'summary'</span>, <span class="s">'sources'</span>] } },
        { type: <span class="s">'word_count'</span>, min: <span class="n">100</span>, max: <span class="n">5000</span> },
      ]
    },
  },

  <span class="c">// Optional REST server</span>
  server: {
    port: <span class="n">4820</span>,
    host: <span class="s">'127.0.0.1'</span>,
  },

  <span class="c">// Webhooks (optional)</span>
  webhooks: {
    on_done: <span class="s">'http://localhost:3000/webhook/task-done'</span>,
    on_blocked: <span class="s">'http://localhost:3000/webhook/task-blocked'</span>,
    on_review: <span class="s">'http://localhost:3000/webhook/task-review'</span>,
  },
});

<span class="c">// Start dispatcher + watchdog</span>
<span class="k">await</span> queue.<span class="f">start</span>();

<span class="c">// Programmatic API (same as REST endpoints)</span>
<span class="k">await</span> queue.<span class="f">createTask</span>({ ... });
<span class="k">await</span> queue.<span class="f">claimNext</span>(<span class="s">'coding'</span>);
<span class="k">await</span> queue.<span class="f">transition</span>(<span class="s">'TASK-abc'</span>, <span class="s">'REVIEW'</span>, { evidence_ref: <span class="s">'...'</span> });

<span class="c">// Graceful shutdown</span>
<span class="k">await</span> queue.<span class="f">stop</span>();</div>

<h3>4.4 Dispatcher Logic</h3>

<div class="code"><span class="c">// Dispatcher poll loop (runs every N seconds):</span>

<span class="k">async function</span> <span class="f">dispatcherTick</span>() {
  <span class="c">// 1. Get all registered adapters</span>
  <span class="k">for</span> (<span class="k">const</span> adapter <span class="k">of</span> adapters) {
    <span class="c">// 2. Check WIP limit for this adapter's task types</span>
    <span class="k">const</span> activeCount = <span class="f">countActiveTasks</span>(adapter.taskTypes);
    <span class="k">const</span> limit = <span class="f">getWipLimit</span>(adapter.taskTypes);
    <span class="k">if</span> (activeCount >= limit) <span class="k">continue</span>;

    <span class="c">// 3. Find next eligible task</span>
    <span class="c">//    - Status = PENDING</span>
    <span class="c">//    - Type matches adapter.canHandle()</span>
    <span class="c">//    - All depends_on tasks are DONE</span>
    <span class="c">//    - attempt_count < max_attempts</span>
    <span class="c">//    - Sorted by: manual_rank ASC NULLS LAST, priority ASC, created_at ASC</span>
    <span class="k">const</span> task = <span class="f">claimNextEligible</span>(adapter);
    <span class="k">if</span> (!task) <span class="k">continue</span>;

    <span class="c">// 4. Atomic claim: PENDING → IN_PROGRESS</span>
    <span class="c">//    Sets lease_owner, lease_expires_at</span>
    <span class="c">//    Uses SQLite BEGIN IMMEDIATE for atomicity</span>
    <span class="f">atomicClaim</span>(task.id, adapter.name);

    <span class="c">// 5. Execute asynchronously (don't block dispatcher)</span>
    <span class="f">executeInBackground</span>(task, adapter);
  }
}

<span class="k">async function</span> <span class="f">executeInBackground</span>(task, adapter) {
  <span class="c">// Start heartbeat interval</span>
  <span class="k">const</span> heartbeat = <span class="f">setInterval</span>(() => {
    queue.<span class="f">heartbeat</span>(task.id);
  }, heartbeatIntervalMs);

  <span class="k">try</span> {
    <span class="c">// Run adapter with gate verification via gated()</span>
    <span class="k">const</span> result = <span class="k">await</span> <span class="f">gated</span>(
      (ctx) => adapter.<span class="f">execute</span>(task, ctx),
      {
        gates: <span class="f">getGatesForTask</span>(task),
        retry: { max: config.recovery.max_attempts, feedback: <span class="k">true</span> },
      }
    );

    <span class="c">// Gates passed → transition to REVIEW</span>
    <span class="k">await</span> queue.<span class="f">transition</span>(task.id, <span class="s">'REVIEW'</span>, {
      result: result.data,
      evidence_ref: result.data.diff || result.data.output,
      gate_results: result.gates,
    });

  } <span class="k">catch</span> (err) {
    <span class="k">if</span> (err <span class="k">instanceof</span> <span class="t">GateExhaustionError</span>) {
      <span class="c">// All retries failed → BLOCKED</span>
      <span class="k">await</span> queue.<span class="f">transition</span>(task.id, <span class="s">'BLOCKED'</span>, {
        last_error: err.message,
        gate_results: err.history,
      });
    } <span class="k">else</span> {
      <span class="c">// Unexpected error → release lease, let watchdog handle</span>
      <span class="k">await</span> queue.<span class="f">release</span>(task.id, err.message);
    }
  } <span class="k">finally</span> {
    <span class="f">clearInterval</span>(heartbeat);
  }
}</div>

<h3>4.5 Watchdog</h3>

<div class="code"><span class="c">// Runs every {heartbeat_interval_seconds} seconds</span>

<span class="k">async function</span> <span class="f">watchdogTick</span>() {
  <span class="k">const</span> now = <span class="k">new</span> <span class="t">Date</span>();
  <span class="k">const</span> grace = config.leases.grace_period_seconds * <span class="n">1000</span>;

  <span class="c">// Find all tasks where lease has expired + grace period</span>
  <span class="k">const</span> stale = db.<span class="f">prepare</span>(<span class="s">`
    SELECT * FROM tasks
    WHERE status = 'IN_PROGRESS'
    AND lease_expires_at IS NOT NULL
    AND datetime(lease_expires_at, '+' || ? || ' seconds') < datetime('now')
  `</span>).<span class="f">all</span>(config.leases.grace_period_seconds);

  <span class="k">for</span> (<span class="k">const</span> task <span class="k">of</span> stale) {
    <span class="k">if</span> (task.attempt_count >= config.recovery.max_attempts) {
      <span class="c">// Max attempts exceeded → BLOCKED</span>
      <span class="f">transition</span>(task.id, <span class="s">'BLOCKED'</span>, {
        last_error: <span class="s">`Watchdog: ${task.attempt_count} attempts exhausted (lease expired)`</span>,
        actor: <span class="s">'watchdog'</span>,
      });
      <span class="f">emitWebhook</span>(<span class="s">'on_blocked'</span>, task);
    } <span class="k">else</span> {
      <span class="c">// Requeue for another attempt</span>
      <span class="f">transition</span>(task.id, <span class="s">'PENDING'</span>, {
        last_error: <span class="s">`Watchdog: lease expired after ${config.leases.ttl_seconds}s`</span>,
        actor: <span class="s">'watchdog'</span>,
        increment_attempt: <span class="k">true</span>,
      });
    }
    <span class="f">auditLog</span>(task.id, <span class="s">'watchdog_recovery'</span>, <span class="s">'IN_PROGRESS'</span>, task.status);
  }
}</div>


<!-- ═══════════════════════════════════════════════════════ -->
<!-- 5. PACKAGE 3: ADAPTERS -->
<!-- ═══════════════════════════════════════════════════════ -->
<h2 id="pkg-adapters">5. Package 3: @openskelo/adapters</h2>

<div class="tag" style="color:var(--purple);">50-120 lines each · Implements one interface · Community-extensible</div>

<h3>5.1 Adapter Interface</h3>

<div class="code"><span class="k">interface</span> <span class="t">ExecutionAdapter</span> {
  <span class="c">// ─── Identity ───</span>
  name: <span class="k">string</span>;                                 <span class="c">// "claude-code", "codex", etc.</span>
  taskTypes: <span class="k">string</span>[];                            <span class="c">// which task types this handles</span>

  <span class="c">// ─── Can this adapter handle this task? ───</span>
  <span class="f">canHandle</span>(task: <span class="t">Task</span>): <span class="k">boolean</span>;

  <span class="c">// ─── Execute the task ───</span>
  <span class="f">execute</span>(task: <span class="t">Task</span>, retryCtx?: <span class="t">RetryContext</span>): <span class="t">Promise</span>&lt;<span class="t">AdapterResult</span>&gt;;

  <span class="c">// ─── Abort a running task ───</span>
  <span class="f">abort</span>(taskId: <span class="k">string</span>): <span class="t">Promise</span>&lt;<span class="k">void</span>&gt;;
}

<span class="k">interface</span> <span class="t">AdapterResult</span> {
  output: <span class="k">string</span>;                  <span class="c">// raw text output from tool</span>
  structured?: <span class="k">any</span>;                <span class="c">// parsed structured data</span>
  files_changed?: <span class="k">string</span>[];        <span class="c">// files modified (for coding tasks)</span>
  diff?: <span class="k">string</span>;                   <span class="c">// git diff</span>
  exit_code: <span class="k">number</span>;               <span class="c">// tool's exit code</span>
  duration_ms: <span class="k">number</span>;             <span class="c">// execution time</span>
  cost?: <span class="k">number</span>;                   <span class="c">// estimated $ cost</span>
}

<span class="k">interface</span> <span class="t">AdapterConfig</span> {
  command?: <span class="k">string</span>;                <span class="c">// CLI command (for CLI-based adapters)</span>
  args?: <span class="k">string</span>[];                 <span class="c">// CLI arguments</span>
  cwd?: <span class="k">string</span>;                    <span class="c">// working directory</span>
  env?: <span class="t">Record</span>&lt;<span class="k">string</span>, <span class="k">string</span>&gt;;   <span class="c">// environment variables</span>
  model?: <span class="k">string</span>;                  <span class="c">// model to use (for API adapters)</span>
  provider?: <span class="k">string</span>;               <span class="c">// API provider (anthropic, openai, etc.)</span>
  timeout_ms?: <span class="k">number</span>;             <span class="c">// execution timeout</span>
}</div>

<h3>5.2 BaseAdapter (Abstract Class)</h3>

<div class="code"><span class="c">// Shared utilities for CLI-based adapters</span>

<span class="k">abstract class</span> <span class="t">BaseCliAdapter</span> <span class="k">implements</span> <span class="t">ExecutionAdapter</span> {
  <span class="k">abstract</span> name: <span class="k">string</span>;
  <span class="k">abstract</span> taskTypes: <span class="k">string</span>[];
  <span class="k">protected</span> config: <span class="t">AdapterConfig</span>;
  <span class="k">private</span> runningProcesses: <span class="t">Map</span>&lt;<span class="k">string</span>, <span class="t">ChildProcess</span>&gt; = <span class="k">new</span> <span class="t">Map</span>();

  <span class="c">// Build the prompt string from task + retry context</span>
  <span class="k">protected abstract</span> <span class="f">buildPrompt</span>(task: <span class="t">Task</span>, retryCtx?: <span class="t">RetryContext</span>): <span class="k">string</span>;

  <span class="c">// Parse tool output into AdapterResult</span>
  <span class="k">protected abstract</span> <span class="f">parseOutput</span>(stdout: <span class="k">string</span>, stderr: <span class="k">string</span>, exitCode: <span class="k">number</span>): <span class="t">AdapterResult</span>;

  <span class="c">// Shared: spawn CLI process, capture output, track for abort</span>
  <span class="k">async</span> <span class="f">execute</span>(task: <span class="t">Task</span>, retryCtx?: <span class="t">RetryContext</span>): <span class="t">Promise</span>&lt;<span class="t">AdapterResult</span>&gt; {
    <span class="k">const</span> prompt = <span class="k">this</span>.<span class="f">buildPrompt</span>(task, retryCtx);
    <span class="k">const</span> start = Date.<span class="f">now</span>();

    <span class="k">const</span> { stdout, stderr, exitCode } = <span class="k">await</span> <span class="k">this</span>.<span class="f">spawn</span>(
      <span class="k">this</span>.config.command,
      <span class="k">this</span>.config.args,
      prompt,
      { cwd: <span class="k">this</span>.config.cwd, env: <span class="k">this</span>.config.env, timeout: <span class="k">this</span>.config.timeout_ms }
    );

    <span class="k">const</span> result = <span class="k">this</span>.<span class="f">parseOutput</span>(stdout, stderr, exitCode);
    result.duration_ms = Date.<span class="f">now</span>() - start;
    <span class="k">return</span> result;
  }

  <span class="k">async</span> <span class="f">abort</span>(taskId: <span class="k">string</span>): <span class="t">Promise</span>&lt;<span class="k">void</span>&gt; {
    <span class="k">const</span> proc = <span class="k">this</span>.runningProcesses.<span class="f">get</span>(taskId);
    <span class="k">if</span> (proc) proc.<span class="f">kill</span>(<span class="s">'SIGTERM'</span>);
  }
}</div>

<h3>5.3 Claude Code Adapter (Reference Implementation)</h3>

<div class="code"><span class="k">class</span> <span class="t">ClaudeCodeAdapter</span> <span class="k">extends</span> <span class="t">BaseCliAdapter</span> {
  name = <span class="s">'claude-code'</span>;
  taskTypes = [<span class="s">'coding'</span>];

  <span class="f">canHandle</span>(task: <span class="t">Task</span>): <span class="k">boolean</span> {
    <span class="k">return</span> task.type === <span class="s">'coding'</span> || task.backend === <span class="s">'claude-code'</span>;
  }

  <span class="k">protected</span> <span class="f">buildPrompt</span>(task: <span class="t">Task</span>, retryCtx?: <span class="t">RetryContext</span>): <span class="k">string</span> {
    <span class="k">let</span> prompt = <span class="s">`Task: ${task.summary}\n\n`</span>;

    <span class="k">if</span> (task.acceptance_criteria?.length) {
      prompt += <span class="s">`Acceptance Criteria:\n`</span>;
      task.acceptance_criteria.<span class="f">forEach</span>((c, i) => {
        prompt += <span class="s">`  ${i + 1}. ${c}\n`</span>;
      });
    }

    <span class="k">if</span> (task.definition_of_done) {
      prompt += <span class="s">`\nDefinition of Done: ${task.definition_of_done}\n`</span>;
    }

    <span class="k">if</span> (task.metadata?.files) {
      prompt += <span class="s">`\nFocus files: ${task.metadata.files.join(', ')}\n`</span>;
    }

    <span class="c">// Inject retry feedback if available</span>
    <span class="k">if</span> (retryCtx?.feedback) {
      prompt += <span class="s">`\n--- RETRY FEEDBACK ---\n${retryCtx.feedback}\n`</span>;
    }

    <span class="c">// Inject human bounce feedback if available</span>
    <span class="k">if</span> (task.feedback_history?.length) {
      <span class="k">const</span> latest = task.feedback_history[task.feedback_history.length - <span class="n">1</span>];
      prompt += <span class="s">`\n--- REVIEWER FEEDBACK ---\n`</span>;
      prompt += <span class="s">`What's wrong: ${latest.what}\n`</span>;
      prompt += <span class="s">`Where: ${latest.where}\n`</span>;
      prompt += <span class="s">`How to fix: ${latest.fix}\n`</span>;
    }

    <span class="k">return</span> prompt;
  }

  <span class="k">protected</span> <span class="f">parseOutput</span>(stdout: <span class="k">string</span>, stderr: <span class="k">string</span>, exitCode: <span class="k">number</span>): <span class="t">AdapterResult</span> {
    <span class="c">// Parse Claude Code's output format</span>
    <span class="c">// Detect file changes from git diff</span>
    <span class="k">const</span> diff = <span class="f">captureGitDiff</span>(<span class="k">this</span>.config.cwd);
    <span class="k">const</span> filesChanged = <span class="f">parseFilesFromDiff</span>(diff);

    <span class="k">return</span> {
      output: stdout,
      files_changed: filesChanged,
      diff: diff,
      exit_code: exitCode,
      duration_ms: <span class="n">0</span>,  <span class="c">// set by BaseCliAdapter</span>
    };
  }
}

<span class="c">// Default config:</span>
<span class="c">// command: "claude"</span>
<span class="c">// args: ["--print", "--model", "sonnet"]</span>
<span class="c">// Input piped via stdin</span></div>

<h3>5.4 All Adapters</h3>

<table>
  <tr><th>Adapter</th><th>Backend</th><th>Task Types</th><th>Input Method</th><th>Lines</th></tr>
  <tr><td><code>claude-code</code></td><td>Claude Code CLI</td><td>coding</td><td>stdin pipe</td><td>~120</td></tr>
  <tr><td><code>codex</code></td><td>OpenAI Codex CLI</td><td>coding</td><td>stdin pipe</td><td>~90</td></tr>
  <tr><td><code>aider</code></td><td>Aider CLI</td><td>coding</td><td>--message flag</td><td>~90</td></tr>
  <tr><td><code>raw-api</code></td><td>HTTP API (Anthropic/OpenAI)</td><td>research, writing, analysis</td><td>API call</td><td>~70</td></tr>
  <tr><td><code>shell</code></td><td>Any shell command</td><td>data, build, deploy</td><td>command string</td><td>~60</td></tr>
</table>


<!-- ═══════════════════════════════════════════════════════ -->
<!-- 6. CONFIGURATION -->
<!-- ═══════════════════════════════════════════════════════ -->
<h2 id="config">6. Configuration Format</h2>

<div class="code"><span class="c"># openskelo.yaml — full example config</span>

<span class="t">queue</span>:
  <span class="f">db_path</span>: <span class="s">"./openskelo.db"</span>
  <span class="f">ordering</span>: [manual_rank, priority, created_at]

  <span class="f">wip_limits</span>:
    coding: <span class="n">1</span>
    research: <span class="n">3</span>
    writing: <span class="n">2</span>
    default: <span class="n">1</span>

  <span class="f">leases</span>:
    ttl_seconds: <span class="n">1200</span>
    heartbeat_interval_seconds: <span class="n">60</span>
    grace_period_seconds: <span class="n">30</span>

  <span class="f">recovery</span>:
    on_lease_expire: <span class="s">requeue</span>
    max_attempts: <span class="n">3</span>
    max_bounces: <span class="n">5</span>

  <span class="f">dispatcher</span>:
    poll_interval_seconds: <span class="n">5</span>
    watchdog_interval_seconds: <span class="n">30</span>

<span class="t">server</span>:
  <span class="f">port</span>: <span class="n">4820</span>
  <span class="f">host</span>: <span class="s">"127.0.0.1"</span>
  <span class="f">api_key</span>: <span class="s">"${OPENSKELO_API_KEY}"</span>  <span class="c"># optional auth</span>

<span class="t">backends</span>:
  <span class="f">claude-code</span>:
    command: <span class="s">"claude"</span>
    args: [<span class="s">"--print"</span>, <span class="s">"--model"</span>, <span class="s">"sonnet"</span>]
    cwd: <span class="s">"~/projects/myapp"</span>
    timeout_ms: <span class="n">600000</span>        <span class="c"># 10 minutes</span>
    env:
      ANTHROPIC_API_KEY: <span class="s">"${ANTHROPIC_API_KEY}"</span>

  <span class="f">codex</span>:
    command: <span class="s">"codex"</span>
    args: [<span class="s">"--model"</span>, <span class="s">"codex-1"</span>]
    cwd: <span class="s">"~/projects/myapp"</span>

  <span class="f">raw-api</span>:
    provider: <span class="s">"anthropic"</span>
    model: <span class="s">"claude-haiku-4-5"</span>
    max_tokens: <span class="n">4096</span>

  <span class="f">shell</span>:
    cwd: <span class="s">"~/projects/myapp"</span>

<span class="t">gates</span>:
  <span class="f">coding</span>:
    post:
      - type: <span class="s">command</span>
        run: <span class="s">"npm test"</span>
        expect_exit: <span class="n">0</span>
        timeout_ms: <span class="n">120000</span>
      - type: <span class="s">expression</span>
        expr: <span class="s">"files_changed.length < 20"</span>
        name: <span class="s">"scope check"</span>
      - type: <span class="s">llm_review</span>
        criteria:
          - <span class="s">"changes are relevant to the task description"</span>
          - <span class="s">"no unrelated refactoring or formatting-only changes"</span>

  <span class="f">research</span>:
    post:
      - type: <span class="s">json_schema</span>
        schema:
          required: [<span class="s">"summary"</span>, <span class="s">"sources"</span>, <span class="s">"confidence"</span>]
      - type: <span class="s">word_count</span>
        min: <span class="n">100</span>
        max: <span class="n">5000</span>
      - type: <span class="s">expression</span>
        expr: <span class="s">"sources.length >= 2"</span>

  <span class="f">writing</span>:
    post:
      - type: <span class="s">word_count</span>
        min: <span class="n">200</span>
        max: <span class="n">10000</span>
      - type: <span class="s">regex</span>
        pattern: <span class="s">"^#"</span>
        name: <span class="s">"has title"</span>

<span class="t">webhooks</span>:
  <span class="f">on_done</span>: <span class="s">"http://localhost:3000/openskelo/done"</span>
  <span class="f">on_blocked</span>: <span class="s">"http://localhost:3000/openskelo/blocked"</span>
  <span class="f">on_review</span>: <span class="s">"http://localhost:3000/openskelo/review"</span></div>


<!-- ═══════════════════════════════════════════════════════ -->
<!-- 7. REST API -->
<!-- ═══════════════════════════════════════════════════════ -->
<h2 id="api">7. REST API Surface</h2>

<table>
  <tr><th>Method</th><th>Endpoint</th><th>Description</th><th>Auth</th></tr>
  <tr><td><span class="pill p-green">POST</span></td><td><code>/tasks</code></td><td>Create task (PENDING)</td><td>API key</td></tr>
  <tr><td><span class="pill p-green">POST</span></td><td><code>/tasks/claim-next</code></td><td>Atomic claim next eligible task</td><td>API key</td></tr>
  <tr><td><span class="pill p-blue">GET</span></td><td><code>/tasks</code></td><td>List tasks (filter by status, type, pipeline)</td><td>API key</td></tr>
  <tr><td><span class="pill p-blue">GET</span></td><td><code>/tasks/:id</code></td><td>Get single task with full details</td><td>API key</td></tr>
  <tr><td><span class="pill p-gold">PATCH</span></td><td><code>/tasks/:id/priority</code></td><td>Set priority (P0-P3)</td><td>API key</td></tr>
  <tr><td><span class="pill p-gold">PATCH</span></td><td><code>/tasks/:id/reorder</code></td><td>Manual rank: <code>top</code> / <code>before:ID</code> / <code>after:ID</code></td><td>API key</td></tr>
  <tr><td><span class="pill p-green">POST</span></td><td><code>/tasks/:id/transition</code></td><td>State change with guard checks</td><td>API key</td></tr>
  <tr><td><span class="pill p-green">POST</span></td><td><code>/tasks/:id/heartbeat</code></td><td>Lease keepalive from adapter</td><td>API key</td></tr>
  <tr><td><span class="pill p-green">POST</span></td><td><code>/tasks/:id/release</code></td><td>Release lease / requeue</td><td>API key</td></tr>
  <tr><td><span class="pill p-blue">GET</span></td><td><code>/audit</code></td><td>Full mutation log (filter by task, action, date)</td><td>API key</td></tr>
  <tr><td><span class="pill p-blue">GET</span></td><td><code>/health</code></td><td>Queue health, task counts, stuck tasks</td><td>None</td></tr>
  <tr><td><span class="pill p-blue">GET</span></td><td><code>/dashboard</code></td><td>Web UI (board view)</td><td>None</td></tr>
</table>

<h3>7.1 Key Request/Response Shapes</h3>

<div class="code"><span class="c">// POST /tasks</span>
<span class="c">// Create a new task</span>
{
  type: <span class="s">"coding"</span>,
  priority: <span class="n">0</span>,
  summary: <span class="s">"Fix login authentication bug"</span>,
  prompt: <span class="s">"Fix the bug in auth.ts where..."</span>,
  acceptance_criteria: [<span class="s">"Users can log in"</span>, <span class="s">"Auth tests pass"</span>],
  definition_of_done: <span class="s">"npm test exits 0"</span>,
  backend: <span class="s">"claude-code"</span>,
  metadata: {
    repo: <span class="s">"~/projects/myapp"</span>,
    files: [<span class="s">"src/auth.ts"</span>, <span class="s">"src/auth.test.ts"</span>]
  }
}
<span class="c">// → 201 { id: "TASK-01JKLM...", status: "PENDING", ... }</span>

<span class="c">// POST /tasks/:id/transition</span>
<span class="c">// Transition with guards</span>
{
  to: <span class="s">"REVIEW"</span>,
  evidence_ref: <span class="s">"diff://abc123"</span>,
  result: { output: <span class="s">"..."</span>, files_changed: [<span class="s">"auth.ts"</span>], exit_code: <span class="n">0</span> }
}
<span class="c">// → 200 { id: "TASK-01JKLM...", status: "REVIEW", ... }</span>

<span class="c">// POST /tasks/:id/transition (bounce / reject)</span>
{
  to: <span class="s">"PENDING"</span>,
  feedback: {
    what: <span class="s">"Login still fails for OAuth users"</span>,
    where: <span class="s">"auth.ts line 42, missing OAuth token check"</span>,
    fix: <span class="s">"Add OAuth token validation before session creation"</span>
  }
}
<span class="c">// → 200 { status: "PENDING", bounce_count: 1, ... }</span></div>


<!-- ═══════════════════════════════════════════════════════ -->
<!-- 8. STATE MACHINE -->
<!-- ═══════════════════════════════════════════════════════ -->
<h2 id="state-machine">8. State Machine</h2>

<div class="card">
<div class="code"><span class="c">Allowed transitions and their required fields:</span>

<span class="t">PENDING</span> ────<span class="f">claim</span>────→ <span class="t">IN_PROGRESS</span>
  requires: lease_owner
  sets: lease_expires_at, attempt_count++

<span class="t">IN_PROGRESS</span> ─<span class="f">submit</span>──→ <span class="t">REVIEW</span>
  requires: evidence_ref OR result
  clears: lease_owner, lease_expires_at

<span class="t">REVIEW</span> ─────<span class="f">approve</span>──→ <span class="t">DONE</span>
  optional: approved_by
  sets: updated_at

<span class="t">REVIEW</span> ─────<span class="f">reject</span>───→ <span class="t">PENDING</span>
  requires: feedback.what, feedback.where, feedback.fix
  sets: bounce_count++, feedback_history.push()
  guard: bounce_count < max_bounces

<span class="t">IN_PROGRESS</span> ─<span class="f">timeout</span>─→ <span class="t">PENDING</span>   <span class="c">(watchdog)</span>
  sets: attempt_count++, last_error
  guard: attempt_count < max_attempts

<span class="t">IN_PROGRESS</span> ─<span class="f">timeout</span>─→ <span class="t">BLOCKED</span>   <span class="c">(watchdog, max exceeded)</span>
  sets: last_error

<span class="t">IN_PROGRESS</span> ─<span class="f">fail</span>────→ <span class="t">BLOCKED</span>   <span class="c">(all gate retries exhausted)</span>
  sets: last_error, gate_results

<span class="c">Any</span> ──────────<span class="f">cancel</span>──→ <span class="t">BLOCKED</span>   <span class="c">(manual intervention)</span>
  optional: reason

<span class="c">─────────────────────────────────────</span>
<span class="c">INVALID TRANSITIONS (always rejected):</span>
  PENDING → DONE          <span class="c">(can't skip execution)</span>
  PENDING → REVIEW        <span class="c">(can't skip execution)</span>
  DONE → anything         <span class="c">(DONE is terminal)</span>
  BLOCKED → IN_PROGRESS   <span class="c">(must go through PENDING)</span>
  REVIEW → IN_PROGRESS    <span class="c">(must bounce to PENDING)</span></div>
</div>


<!-- ═══════════════════════════════════════════════════════ -->
<!-- 9. FAILURE MODES -->
<!-- ═══════════════════════════════════════════════════════ -->
<h2 id="failure-modes">9. Failure Modes &amp; Recovery</h2>

<table>
  <tr><th>Failure</th><th>Detection</th><th>Response</th><th>Max</th><th>Escalation</th></tr>
  <tr><td>Gate fails</td><td>Gate returns <code>passed: false</code></td><td>Auto-retry with failure feedback</td><td>3 attempts</td><td>BLOCKED + webhook</td></tr>
  <tr><td>Tool crashes</td><td>Heartbeat stops</td><td>Watchdog requeues after grace period</td><td>3 attempts</td><td>BLOCKED + webhook</td></tr>
  <tr><td>Tool timeout</td><td>Lease expires</td><td>Watchdog requeues</td><td>3 attempts</td><td>BLOCKED + webhook</td></tr>
  <tr><td>Human rejects</td><td><code>POST /transition</code> with feedback</td><td>Back to PENDING with feedback attached</td><td>5 bounces</td><td>BLOCKED + webhook</td></tr>
  <tr><td>Dependency stuck</td><td>Dispatcher checks <code>depends_on</code></td><td>Task stays PENDING until deps resolve</td><td>N/A</td><td>Dashboard shows blocked chain</td></tr>
  <tr><td>Adapter missing</td><td>No adapter for <code>backend</code></td><td>Task stays PENDING, logged as warning</td><td>N/A</td><td>Health endpoint reports it</td></tr>
  <tr><td>DB corruption</td><td>SQLite integrity check</td><td>WAL recovery + health endpoint alert</td><td>N/A</td><td>Manual backup restoration</td></tr>
  <tr><td>Queue server crash</td><td>Process exit</td><td>Restart picks up from DB state</td><td>N/A</td><td>All state survives in SQLite</td></tr>
</table>


<!-- ═══════════════════════════════════════════════════════ -->
<!-- 10. PIPELINES -->
<!-- ═══════════════════════════════════════════════════════ -->
<h2 id="pipelines">10. Multi-Step Pipelines</h2>

<div class="code"><span class="c">// Create a pipeline: research → write → review</span>

<span class="k">const</span> pipelineId = <span class="s">"PL-blog-post"</span>;

<span class="c">// Step 1: Research</span>
<span class="k">await</span> queue.<span class="f">createTask</span>({
  type: <span class="s">"research"</span>,
  backend: <span class="s">"raw-api"</span>,
  summary: <span class="s">"Research AI orchestration trends"</span>,
  prompt: <span class="s">"Find 5 recent sources about..."</span>,
  pipeline_id: pipelineId,
  pipeline_step: <span class="n">1</span>,
  depends_on: [],
});

<span class="c">// Step 2: Write (depends on research)</span>
<span class="k">await</span> queue.<span class="f">createTask</span>({
  type: <span class="s">"writing"</span>,
  backend: <span class="s">"raw-api"</span>,
  summary: <span class="s">"Write blog post draft"</span>,
  prompt: <span class="s">"Using the research from step 1, write..."</span>,
  pipeline_id: pipelineId,
  pipeline_step: <span class="n">2</span>,
  depends_on: [<span class="s">"TASK-step1-id"</span>],  <span class="c">// won't start until step 1 is DONE</span>
});

<span class="c">// Step 3: Code (depends on write)</span>
<span class="k">await</span> queue.<span class="f">createTask</span>({
  type: <span class="s">"coding"</span>,
  backend: <span class="s">"claude-code"</span>,
  summary: <span class="s">"Format and publish blog post"</span>,
  prompt: <span class="s">"Take the draft from step 2 and create..."</span>,
  pipeline_id: pipelineId,
  pipeline_step: <span class="n">3</span>,
  depends_on: [<span class="s">"TASK-step2-id"</span>],
});

<span class="c">// Dispatcher automatically:</span>
<span class="c">// - Starts step 1 immediately</span>
<span class="c">// - Starts step 2 only when step 1 gates pass and status = DONE</span>
<span class="c">// - Passes step 1 output into step 2's context</span>
<span class="c">// - Etc.</span></div>

<h3>Pipeline Output Forwarding</h3>

<p>When a task in a pipeline completes, its <code>result</code> is available to downstream tasks. The dispatcher injects the upstream result into the downstream task's prompt context:</p>

<div class="code"><span class="c">// Step 2 receives:</span>
{
  prompt: <span class="s">"Write blog post..."</span>,
  <span class="c">// Auto-injected by dispatcher:</span>
  upstream_results: {
    <span class="s">"TASK-step1-id"</span>: {
      summary: <span class="s">"Research AI orchestration trends"</span>,
      output: <span class="s">"[full research output]"</span>,
      gate_results: [{ gate: <span class="s">"json_schema"</span>, passed: <span class="k">true</span> }],
    }
  }
}</div>


<!-- ═══════════════════════════════════════════════════════ -->
<!-- 11. TIERED GATING -->
<!-- ═══════════════════════════════════════════════════════ -->
<h2 id="tiered-gating">11. Tiered Gating (Agent Wrapping)</h2>

<p>When an OpenClaw bot (or any agent) uses OpenSkelo, different actions get different levels of scrutiny. This is configurable per task type and per action classification:</p>

<table>
  <tr><th>Action</th><th>Gate Level</th><th>Gates Applied</th><th>Latency</th></tr>
  <tr><td>Casual response</td><td>None</td><td>Pass through immediately</td><td>0ms</td></tr>
  <tr><td>Information delivery</td><td>Light</td><td>word_count, regex format check</td><td>&lt;1ms</td></tr>
  <tr><td>Task creation</td><td>Full</td><td>json_schema (required fields), expression (priority valid)</td><td>&lt;5ms</td></tr>
  <tr><td>Delegation / routing</td><td>Full</td><td>expression (adapter exists, WIP under limit, type matches)</td><td>&lt;5ms</td></tr>
  <tr><td>Code execution</td><td>Full + command</td><td>All above + npm test + diff review</td><td>Varies</td></tr>
  <tr><td>Money / trade action</td><td>Maximum</td><td>All above + llm_review + human approval gate</td><td>Varies</td></tr>
</table>

<div class="note">
  <strong>Implementation note:</strong> Tiered gating is a configuration pattern, not a separate system. The agent's output is classified (by the agent itself or a cheap classifier), and the appropriate gate set from config is applied. The gate engine is the same everywhere.
</div>


<!-- ═══════════════════════════════════════════════════════ -->
<!-- 12. DASHBOARD -->
<!-- ═══════════════════════════════════════════════════════ -->
<h2 id="dashboard">12. Dashboard</h2>

<p>Minimal web UI served from the queue's Express server at <code>GET /dashboard</code>.</p>

<h4>Views</h4>
<table>
  <tr><th>View</th><th>What it shows</th></tr>
  <tr><td>Board</td><td>Kanban-style columns: PENDING | IN_PROGRESS | REVIEW | DONE | BLOCKED. Drag to reorder within PENDING.</td></tr>
  <tr><td>Queue</td><td>Ordered list showing exact dequeue order with priority, rank, age. Next-to-be-claimed highlighted.</td></tr>
  <tr><td>Task Detail</td><td>Full task data, gate results per attempt, feedback history, audit log for this task.</td></tr>
  <tr><td>Health</td><td>Active leases, stuck task count, gate pass/fail rates, avg execution time, cost tracking.</td></tr>
  <tr><td>Pipeline</td><td>DAG visualization for multi-step pipelines. Shows which steps are done, active, pending.</td></tr>
</table>

<div class="note">
  <strong>Implementation:</strong> Single HTML page with inline JS. No React, no build step. Fetches data from REST API. Auto-refreshes every 5 seconds. Shipped as a static string embedded in the queue package.
</div>


<!-- ═══════════════════════════════════════════════════════ -->
<!-- 13. SECURITY -->
<!-- ═══════════════════════════════════════════════════════ -->
<h2 id="security">13. Security &amp; Limits</h2>

<table>
  <tr><th>Concern</th><th>Mitigation</th></tr>
  <tr><td>Expression injection</td><td>Sandboxed evaluator. Whitelist-only: property access, arithmetic, comparison, logical ops. No <code>process</code>, <code>require</code>, <code>import</code>, <code>eval</code>, <code>Function</code>.</td></tr>
  <tr><td>Command injection (command gate)</td><td>Commands are defined in config, not in task data. Task data is never interpolated into shell commands. Only the command string from gate config runs.</td></tr>
  <tr><td>API key exposure</td><td>Keys stored in env vars, referenced via <code>${VAR}</code> in YAML. Never logged, never in audit trail.</td></tr>
  <tr><td>REST API auth</td><td>Optional API key header. Localhost-only by default. No external access unless explicitly configured.</td></tr>
  <tr><td>SQLite access</td><td>Single-writer. WAL mode for concurrent reads. File permissions match process user.</td></tr>
  <tr><td>Task payload size</td><td>Max 1MB per task prompt. Max 10MB per result. Configurable.</td></tr>
  <tr><td>Webhook security</td><td>Optional HMAC signature on webhook payloads. Shared secret in config.</td></tr>
  <tr><td>Adapter process isolation</td><td>Each adapter spawns a child process. Killed on abort/timeout. No shared memory with queue process.</td></tr>
</table>

<h3>Rate Limits</h3>
<table>
  <tr><th>Resource</th><th>Default Limit</th><th>Configurable</th></tr>
  <tr><td>Task creation</td><td>100/minute</td><td>Yes</td></tr>
  <tr><td>Claim-next calls</td><td>60/minute</td><td>Yes</td></tr>
  <tr><td>Heartbeat calls</td><td>Unlimited (per task lease)</td><td>No</td></tr>
  <tr><td>LLM review gates</td><td>Inherits provider rate limits</td><td>N/A</td></tr>
</table>


<!-- ═══════════════════════════════════════════════════════ -->
<!-- 14. TESTING -->
<!-- ═══════════════════════════════════════════════════════ -->
<h2 id="testing">14. Testing Strategy</h2>

<h4>Gates Package (target: 150+ tests)</h4>
<table>
  <tr><th>Category</th><th>Tests</th><th>What</th></tr>
  <tr><td>json_schema gate</td><td>~25</td><td>Required fields, nested objects, arrays, types, Zod schemas, error messages</td></tr>
  <tr><td>expression gate</td><td>~25</td><td>Arithmetic, comparison, logical, nested property access, injection blocked</td></tr>
  <tr><td>regex gate</td><td>~15</td><td>Match, no-match, invert, flags, invalid patterns</td></tr>
  <tr><td>word_count gate</td><td>~10</td><td>Min, max, both, exact, edge cases</td></tr>
  <tr><td>command gate</td><td>~15</td><td>Exit codes, timeout, stderr capture, cwd, env vars</td></tr>
  <tr><td>llm_review gate</td><td>~15</td><td>Mock provider, criteria scoring, threshold, cost tracking</td></tr>
  <tr><td>custom gate</td><td>~10</td><td>Sync/async functions, error handling</td></tr>
  <tr><td>Runner (multi-gate)</td><td>~15</td><td>Sequence evaluation, short-circuit, all-gates mode</td></tr>
  <tr><td>Retry engine</td><td>~20</td><td>Feedback compilation, attempt counting, exhaustion error, delay/backoff</td></tr>
</table>

<h4>Queue Package (target: 100+ tests)</h4>
<table>
  <tr><th>Category</th><th>Tests</th><th>What</th></tr>
  <tr><td>Task CRUD</td><td>~15</td><td>Create, read, update, list, filter</td></tr>
  <tr><td>Priority ordering</td><td>~20</td><td>Deterministic sort, manual rank override, ties, edge cases</td></tr>
  <tr><td>State machine</td><td>~20</td><td>Valid transitions, invalid transitions rejected, required fields enforced</td></tr>
  <tr><td>Atomic claims</td><td>~15</td><td>No double-claim, WIP limit enforcement, concurrent claim safety</td></tr>
  <tr><td>Leases + watchdog</td><td>~15</td><td>Heartbeat extends lease, expiry detected, requeue on timeout, BLOCKED on max</td></tr>
  <tr><td>Pipelines</td><td>~10</td><td>Dependency resolution, output forwarding, blocked chain detection</td></tr>
  <tr><td>Audit log</td><td>~10</td><td>Every mutation logged, query by task/action/date</td></tr>
</table>

<h4>Adapter Package (target: 50+ tests)</h4>
<table>
  <tr><th>Category</th><th>Tests</th><th>What</th></tr>
  <tr><td>Base adapter</td><td>~15</td><td>Process spawn, stdin pipe, stdout capture, abort, timeout</td></tr>
  <tr><td>Claude Code adapter</td><td>~15</td><td>Prompt building, output parsing, diff capture, retry context injection</td></tr>
  <tr><td>Raw API adapter</td><td>~10</td><td>API call, response parsing, cost tracking</td></tr>
  <tr><td>Integration</td><td>~10</td><td>Full flow: task → adapter → gates → result (with mock tools)</td></tr>
</table>


<!-- ═══════════════════════════════════════════════════════ -->
<!-- 15. DEPENDENCIES -->
<!-- ═══════════════════════════════════════════════════════ -->
<h2 id="dependencies">15. Dependencies</h2>

<h4>Production</h4>
<table>
  <tr><th>Package</th><th>Used By</th><th>Why</th></tr>
  <tr><td><code>zod</code></td><td>gates</td><td>Schema validation for json_schema gate</td></tr>
  <tr><td><code>better-sqlite3</code></td><td>queue</td><td>SQLite driver (synchronous, fast, WAL support)</td></tr>
  <tr><td><code>express</code></td><td>queue (optional)</td><td>REST API server</td></tr>
  <tr><td><code>ulid</code></td><td>queue</td><td>Sortable unique IDs for tasks</td></tr>
  <tr><td><code>yaml</code></td><td>queue</td><td>Config file parsing</td></tr>
</table>

<h4>Development</h4>
<table>
  <tr><th>Package</th><th>Why</th></tr>
  <tr><td><code>typescript</code></td><td>Language</td></tr>
  <tr><td><code>vitest</code></td><td>Test runner</td></tr>
  <tr><td><code>tsup</code></td><td>Build / bundle (fast, esbuild-based)</td></tr>
  <tr><td><code>@changesets/cli</code></td><td>Version management across packages</td></tr>
</table>

<h4>Peer Dependencies (user provides)</h4>
<table>
  <tr><th>Package</th><th>When</th></tr>
  <tr><td><code>@anthropic-ai/sdk</code></td><td>If using llm_review gate with Anthropic</td></tr>
  <tr><td><code>openai</code></td><td>If using llm_review gate with OpenAI</td></tr>
  <tr><td>Claude Code CLI</td><td>If using claude-code adapter</td></tr>
  <tr><td>Codex CLI</td><td>If using codex adapter</td></tr>
</table>


<!-- ═══════════════════════════════════════════════════════ -->
<!-- 16. BUILD PLAN -->
<!-- ═══════════════════════════════════════════════════════ -->
<h2 id="build-plan">16. Build Plan &amp; Timeline</h2>

<h3>Phase 1: Gates (Days 1-10)</h3>

<table>
  <tr><th>Day</th><th>Deliverable</th><th>Done When</th></tr>
  <tr><td>1</td><td>Monorepo scaffold + CI</td><td>npm workspaces, tsconfig, vitest, tsup build runs green</td></tr>
  <tr><td>2-3</td><td>Core gate types: json_schema, expression, regex, word_count</td><td>Each gate has 15+ tests passing. Safe-eval sandboxed.</td></tr>
  <tr><td>4-5</td><td>command gate + llm_review gate</td><td>Command gate runs shell commands. LLM review works with mock provider.</td></tr>
  <tr><td>6-7</td><td>Gate runner + retry engine</td><td>Multi-gate sequence evaluation. Retry-with-feedback loop. Feedback compilation. 150+ total tests.</td></tr>
  <tr><td>8</td><td><code>gated()</code> public API</td><td>Single-function wrapper works end-to-end. Extract modes (json, text, auto, custom).</td></tr>
  <tr><td>9</td><td>Docs + README + examples</td><td>README with usage examples. JSDoc on all exports. 3 example scripts.</td></tr>
  <tr><td>10</td><td>Publish <code>@openskelo/gates@0.1.0</code></td><td>On npm. Install works. Examples run. CI green.</td></tr>
</table>

<h3>Phase 2: Adapters (Days 11-18)</h3>

<table>
  <tr><th>Day</th><th>Deliverable</th><th>Done When</th></tr>
  <tr><td>11-12</td><td>Base adapter + types</td><td>ExecutionAdapter interface. BaseCliAdapter with spawn, capture, abort.</td></tr>
  <tr><td>13-14</td><td>claude-code adapter</td><td>Full prompt building, output parsing, diff capture. 15+ tests with mocked CLI.</td></tr>
  <tr><td>15</td><td>raw-api adapter</td><td>Direct API call adapter. Works with Anthropic SDK. 10+ tests.</td></tr>
  <tr><td>16</td><td>shell adapter</td><td>Run any command. Capture output. 10+ tests.</td></tr>
  <tr><td>17</td><td>codex + aider adapters</td><td>Both working with mocked CLI. 10+ tests each.</td></tr>
  <tr><td>18</td><td>Publish <code>@openskelo/adapters@0.1.0</code></td><td>On npm. All adapters work standalone.</td></tr>
</table>

<h3>Phase 3: Queue (Days 19-35)</h3>

<table>
  <tr><th>Day</th><th>Deliverable</th><th>Done When</th></tr>
  <tr><td>19-20</td><td>SQLite schema + task store</td><td>CRUD operations. Indexes. Migrations.</td></tr>
  <tr><td>21-23</td><td>State machine + transition guards</td><td>All valid transitions work. Invalid transitions rejected. Required fields enforced. 20+ tests.</td></tr>
  <tr><td>24-25</td><td>Priority queue + ordering</td><td>Deterministic sort. Manual rank override. 20+ tests.</td></tr>
  <tr><td>26-27</td><td>Dispatcher + atomic claims</td><td>Claim-next works. WIP limits enforced. No double-claims. Concurrent safety.</td></tr>
  <tr><td>28-29</td><td>Leases + watchdog</td><td>Heartbeat extends lease. Expiry detection. Auto-requeue. BLOCKED on max attempts.</td></tr>
  <tr><td>30-31</td><td>Pipeline support</td><td>depends_on resolution. Output forwarding. Blocked chain detection.</td></tr>
  <tr><td>32</td><td>REST API (Express)</td><td>All endpoints working. API key auth. Health endpoint.</td></tr>
  <tr><td>33</td><td>Audit log</td><td>Every mutation logged. Queryable by task, action, date range.</td></tr>
  <tr><td>34</td><td>Dashboard</td><td>Board view, queue view, task detail, health view. Auto-refresh.</td></tr>
  <tr><td>35</td><td>Publish <code>@openskelo/queue@0.1.0</code></td><td>On npm. Full integration test: create task → dispatch → execute → gates → done.</td></tr>
</table>

<h3>Phase 4: Integration (Days 36-42)</h3>

<table>
  <tr><th>Day</th><th>Deliverable</th><th>Done When</th></tr>
  <tr><td>36-37</td><td>Config loader (YAML)</td><td>openskelo.yaml parsed. All sections mapped to runtime config. Env var substitution.</td></tr>
  <tr><td>38-39</td><td>CLI tool: <code>npx openskelo</code></td><td><code>openskelo init</code> generates config. <code>openskelo start</code> starts queue + dispatcher. <code>openskelo status</code> shows board.</td></tr>
  <tr><td>40-41</td><td>OpenClaw integration example</td><td>Working example: Telegram → OpenClaw bot → queue API → Claude Code → gates → notification.</td></tr>
  <tr><td>42</td><td>Blog post + launch</td><td>X article published. GitHub repo public. npm packages live. Examples working.</td></tr>
</table>

<div class="warn">
  <strong>Total: ~6 weeks from zero to shipped.</strong> Phase 1 (gates) ships at day 10 — that's the earliest npm install works. Each phase adds capability without breaking previous phases.
</div>


<!-- ═══════════════════════════════════════════════════════ -->
<!-- FOOTER -->
<!-- ═══════════════════════════════════════════════════════ -->
<div style="margin-top:60px;padding-top:24px;border-top:1px solid var(--border);text-align:center;">
  <p style="color:var(--dim);font-size:13px;">
    OpenSkelo Technical Specification v0.1<br/>
    Three packages. All free. All open source. MIT license.<br/>
    <span style="color:var(--green);">@openskelo/gates</span> · <span style="color:var(--gold);">@openskelo/queue</span> · <span style="color:var(--purple);">@openskelo/adapters</span>
  </p>
</div>

</div>
</body>
</html>