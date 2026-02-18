#!/usr/bin/env node

import { appendFileSync } from "node:fs";

const {
  GITHUB_TOKEN,
  ANTHROPIC_API_KEY,
  GITHUB_REPOSITORY,
  PR_NUMBER,
  BASE_REF,
  BLOCKING_MODE = "true",
  ANTHROPIC_MODEL = "claude-sonnet-4-5",
  MAX_FILES = "120",
  MAX_PATCH_CHARS = "140000",
  GITHUB_OUTPUT,
} = process.env;

if (!GITHUB_TOKEN) fail("Missing GITHUB_TOKEN");
if (!GITHUB_REPOSITORY) fail("Missing GITHUB_REPOSITORY");
if (!PR_NUMBER) fail("Missing PR_NUMBER");
if (!ANTHROPIC_API_KEY) fail("Missing ANTHROPIC_API_KEY");

const [owner, repo] = GITHUB_REPOSITORY.split("/");
const blocking = String(BLOCKING_MODE) === "true";
const maxFiles = Number(MAX_FILES) || 120;
const maxPatchChars = Number(MAX_PATCH_CHARS) || 140000;

async function gh(path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status}: ${txt || res.statusText}`);
  }
  return res.status === 204 ? null : res.json();
}

function truncate(str, n) {
  if (!str) return "";
  return str.length <= n ? str : `${str.slice(0, n)}\n... [truncated]`;
}

async function listPrFiles() {
  const files = [];
  let page = 1;
  while (true) {
    const data = await gh(`/repos/${owner}/${repo}/pulls/${PR_NUMBER}/files?per_page=100&page=${page}`);
    if (!Array.isArray(data) || data.length === 0) break;
    files.push(...data);
    if (data.length < 100) break;
    page += 1;
  }
  return files;
}

function buildDiffPayload(files) {
  const summary = {
    file_count: files.length,
    additions: files.reduce((n, f) => n + (f.additions || 0), 0),
    deletions: files.reduce((n, f) => n + (f.deletions || 0), 0),
    changed: files.map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      changes: f.changes,
    })),
  };

  let used = 0;
  const patches = [];
  for (const f of files) {
    const patch = f.patch || "";
    if (!patch) continue;
    const remain = maxPatchChars - used;
    if (remain <= 0) break;
    const clipped = truncate(patch, Math.min(remain, 8000));
    used += clipped.length;
    patches.push({ filename: f.filename, patch: clipped });
  }

  return { summary, patches };
}

async function anthropicReview(payload) {
  const system = [
    "You are a strict, practical senior engineer reviewing a GitHub PR.",
    "Focus on correctness, security, error handling, regression risk, and test adequacy.",
    "Avoid style nitpicks unless they materially affect maintainability.",
    "For CI/infrastructure files (.github/workflows/, scripts used by CI): review for correctness and functionality but apply lighter security scrutiny — these are internal tooling, not user-facing application code. Do not flag shell variable usage for secrets that GitHub Actions already masks.",
    "Return ONLY valid JSON with this schema:",
    "{",
    '  "verdict": "APPROVE|REQUEST_CHANGES|COMMENT",',
    '  "summary": "string",',
    '  "top_risks": ["string"],',
    '  "required_fixes": ["string"],',
    '  "nice_to_have": ["string"],',
    '  "retest_plan": ["string"]',
    "}",
  ].join("\n");

  const user = [
    `Repository: ${owner}/${repo}`,
    `PR: #${PR_NUMBER}`,
    `Base branch: ${BASE_REF}`,
    "",
    "PR summary + diff patches:",
    JSON.stringify(payload, null, 2),
  ].join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1800,
      temperature: 0,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status}: ${text || res.statusText}`);
  }

  const data = await res.json();
  const text = (data?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  const jsonText = extractJson(text);
  const parsed = JSON.parse(jsonText);
  const verdict = String(parsed.verdict || "COMMENT").toUpperCase();

  return {
    verdict: ["APPROVE", "REQUEST_CHANGES", "COMMENT"].includes(verdict) ? verdict : "COMMENT",
    summary: String(parsed.summary || "No summary provided."),
    top_risks: toArr(parsed.top_risks),
    required_fixes: toArr(parsed.required_fixes),
    nice_to_have: toArr(parsed.nice_to_have),
    retest_plan: toArr(parsed.retest_plan),
  };
}

function toArr(v) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x)).filter(Boolean).slice(0, 8);
}

function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) throw new Error("Model did not return JSON");
  return text.slice(start, end + 1);
}

function formatBody(r, oversized = false) {
  const lines = [];
  lines.push(`## 🤖 Claude PR Review — ${r.verdict}`);
  if (oversized) lines.push("\n> ⚠️ Large diff detected; review may be partial.");
  lines.push(`\n### Summary\n${r.summary}`);

  const section = (title, arr) => {
    lines.push(`\n### ${title}`);
    if (!arr?.length) lines.push("- None");
    else arr.forEach((x) => lines.push(`- ${x}`));
  };

  section("Top risks", r.top_risks);
  section("Required fixes", r.required_fixes);
  section("Nice to have", r.nice_to_have);
  section("Retest plan", r.retest_plan);
  return lines.join("\n");
}

async function submitReview(verdict, body) {
  let event = "COMMENT";
  if (verdict === "APPROVE") event = "APPROVE";
  if (verdict === "REQUEST_CHANGES") event = "REQUEST_CHANGES";

  await gh(`/repos/${owner}/${repo}/pulls/${PR_NUMBER}/reviews`, {
    method: "POST",
    body: JSON.stringify({
      event,
      body,
    }),
  });
}

function setOutput(key, value) {
  if (!GITHUB_OUTPUT) return;
  appendFileSync(GITHUB_OUTPUT, `${key}=${value}\n`);
}

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

(async () => {
  try {
    const files = await listPrFiles();
    const oversized = files.length > maxFiles;

    if (oversized) {
      const body = [
        "## 🤖 Claude PR Review — COMMENT",
        "",
        `Large diff detected (${files.length} files > ${maxFiles} limit).`,
        "Please split this PR or request manual review.",
      ].join("\n");
      await submitReview("COMMENT", body);
      setOutput("verdict", "COMMENT");
      process.exit(0);
    }

    const payload = buildDiffPayload(files);
    const result = await anthropicReview(payload);
    // In advisory mode, downgrade REQUEST_CHANGES to COMMENT so it doesn't block the PR
    const effectiveVerdict = !blocking && result.verdict === "REQUEST_CHANGES" ? "COMMENT" : result.verdict;
    const body = formatBody(result, false);
    await submitReview(effectiveVerdict, body);

    setOutput("verdict", effectiveVerdict);

    if (blocking && result.verdict === "REQUEST_CHANGES") {
      console.error("Blocking mode: REQUEST_CHANGES");
      process.exit(1);
    }

    process.exit(0);
  } catch (err) {
    console.error("AI review failed:", err instanceof Error ? err.message : err);
    setOutput("verdict", "COMMENT");
    // Fail closed on feature branches, advisory on main
    if (blocking) process.exit(1);
    process.exit(0);
  }
})();
