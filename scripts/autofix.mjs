#!/usr/bin/env node

import { execSync } from "node:child_process";

const {
  GITHUB_TOKEN,
  ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL = "claude-opus-4-1",
  GITHUB_REPOSITORY,
  PR_NUMBER,
  PR_HEAD_REF,
  REVIEW_BODY = "",
  MAX_AUTOFIX_ATTEMPTS = "3",
} = process.env;

if (!GITHUB_TOKEN) fail("Missing GITHUB_TOKEN");
if (!ANTHROPIC_API_KEY) fail("Missing ANTHROPIC_API_KEY");
if (!GITHUB_REPOSITORY) fail("Missing GITHUB_REPOSITORY");
if (!PR_NUMBER) fail("Missing PR_NUMBER");
if (!PR_HEAD_REF) fail("Missing PR_HEAD_REF");

const [owner, repo] = GITHUB_REPOSITORY.split("/");
const maxAttempts = Number(MAX_AUTOFIX_ATTEMPTS) || 3;
const marker = "<!-- AUTOFIX_ATTEMPT -->";

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

async function listIssueComments() {
  const comments = [];
  let page = 1;
  while (true) {
    const data = await gh(`/repos/${owner}/${repo}/issues/${PR_NUMBER}/comments?per_page=100&page=${page}`);
    if (!Array.isArray(data) || data.length === 0) break;
    comments.push(...data);
    if (data.length < 100) break;
    page += 1;
  }
  return comments;
}

async function postComment(body) {
  await gh(`/repos/${owner}/${repo}/issues/${PR_NUMBER}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

function run(cmd) {
  execSync(cmd, { stdio: "inherit" });
}

function runCapture(cmd) {
  return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString();
}

function tryRun(cmd) {
  try {
    execSync(cmd, { stdio: "inherit" });
    return true;
  } catch {
    return false;
  }
}

function parseJsonBlock(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) throw new Error("Model response was not JSON");
  return JSON.parse(text.slice(start, end + 1));
}

function validateEditTargets(edits, allowedFiles) {
  const allowed = new Set(allowedFiles);
  for (const e of edits) {
    if (!e || typeof e !== "object") throw new Error("Invalid edit object");
    const file = String(e.file || "");
    if (!file || file.includes("..") || file.startsWith("/") || file.startsWith("~")) {
      throw new Error(`Unsafe file path in edit: ${file}`);
    }
    if (!allowed.has(file)) {
      throw new Error(`Edit targets non-PR file: ${file}`);
    }
    if (typeof e.find !== "string" || typeof e.replace !== "string") {
      throw new Error(`Edit for ${file} must include string find/replace`);
    }
  }
}

function applyEdits(edits) {
  for (const e of edits) {
    const file = e.file;
    const content = runCapture(`python3 - <<'PY'\nfrom pathlib import Path\nprint(Path(${JSON.stringify(file)}).read_text())\nPY`);
    if (!content.includes(e.find)) {
      throw new Error(`Did not find expected text in ${file}`);
    }

    run(`python3 - <<'PY'\nfrom pathlib import Path\np = Path(${JSON.stringify(file)})\ntext = p.read_text()\nold = ${JSON.stringify(e.find)}\nnew = ${JSON.stringify(e.replace)}\nif old not in text:\n    raise SystemExit(1)\np.write_text(text.replace(old, new, 1))\nPY`);
  }
}

async function generateFixes(payload) {
  const system = [
    "You are an expert TypeScript engineer fixing PR review feedback.",
    "Return ONLY valid JSON with this exact schema:",
    "{",
    '  "summary": "string",',
    '  "edits": [',
    '    { "file": "string", "find": "exact existing text", "replace": "replacement text" }',
    "  ]",
    "}",
    "Rules:",
    "- Only edit files provided in allowed_files.",
    "- Keep edits minimal and deterministic.",
    "- Do not propose partial snippets that cannot be found exactly.",
    "- Prefer 1-6 edits total.",
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
      max_tokens: 3500,
      temperature: 0,
      system,
      messages: [{ role: "user", content: JSON.stringify(payload, null, 2) }],
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status}: ${txt || res.statusText}`);
  }

  const data = await res.json();
  const text = (data?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  return parseJsonBlock(text);
}

function collectChangedFilesOnDisk() {
  const out = runCapture("git status --porcelain");
  const files = out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.slice(3));
  return files;
}

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

(async () => {
  try {
    const prFiles = await listPrFiles();
    const allowedFiles = prFiles
      .map((f) => f.filename)
      .filter((f) => !f.startsWith(".github/workflows/"));

    const comments = await listIssueComments();
    const priorAttempts = comments.filter((c) => (c.body || "").includes(marker)).length;
    const attempt = priorAttempts + 1;

    if (attempt > maxAttempts) {
      await postComment([
        `${marker}`,
        `⚠️ **Autofix stopped** — reached max attempts (${maxAttempts}).`,
        "Please handle this PR manually.",
      ].join("\n\n"));
      process.exit(0);
    }

    await postComment([
      `${marker}`,
      `🔁 **Autofix attempt ${attempt}/${maxAttempts} started**`,
      "Applying AI-requested changes, then running build+tests.",
    ].join("\n\n"));

    const payload = {
      repo: GITHUB_REPOSITORY,
      pr_number: Number(PR_NUMBER),
      branch: PR_HEAD_REF,
      review_feedback: REVIEW_BODY,
      allowed_files: allowedFiles,
      changed_files: prFiles.map((f) => ({ filename: f.filename, patch: f.patch || "" })),
    };

    const fix = await generateFixes(payload);
    const edits = Array.isArray(fix.edits) ? fix.edits : [];
    if (edits.length === 0) {
      await postComment([
        `${marker}`,
        `⚠️ **Autofix attempt ${attempt}/${maxAttempts} produced no edits**`,
        "Please handle this PR manually.",
      ].join("\n\n"));
      process.exit(0);
    }

    validateEditTargets(edits, allowedFiles);
    applyEdits(edits);

    const changed = collectChangedFilesOnDisk();
    const allowed = new Set(allowedFiles);
    const illegal = changed.filter((f) => !allowed.has(f));
    if (illegal.length > 0) {
      throw new Error(`Autofix modified non-PR files: ${illegal.join(", ")}`);
    }

    const buildOk = tryRun("npm run build");
    const testOk = buildOk ? tryRun("npm test") : false;

    if (!buildOk || !testOk) {
      await postComment([
        `${marker}`,
        `❌ **Autofix attempt ${attempt}/${maxAttempts} failed verification**`,
        "Build/test failed after edits. No commit pushed.",
      ].join("\n\n"));
      process.exit(1);
    }

    run("git config user.name 'github-actions[bot]'");
    run("git config user.email '41898282+github-actions[bot]@users.noreply.github.com'");
    run("git add -A");

    const hasDiff = runCapture("git status --porcelain").trim().length > 0;
    if (!hasDiff) {
      await postComment([
        `${marker}`,
        `ℹ️ **Autofix attempt ${attempt}/${maxAttempts} had no net diff**`,
        "Nothing to commit.",
      ].join("\n\n"));
      process.exit(0);
    }

    run(`git commit -m ${JSON.stringify(`fix(autofix): address ai-review feedback [attempt ${attempt}]`)}`);
    run(`git push origin ${PR_HEAD_REF}`);

    await postComment([
      `${marker}`,
      `✅ **Autofix attempt ${attempt}/${maxAttempts} pushed**`,
      "Build + tests passed; CI and AI review will re-run automatically.",
      fix.summary ? `\nSummary: ${fix.summary}` : "",
    ].join("\n\n"));
  } catch (err) {
    await postComment([
      `${marker}`,
      "❌ **Autofix failed unexpectedly**",
      `Error: ${err instanceof Error ? err.message : String(err)}`,
      "Please handle this PR manually.",
    ].join("\n\n"));
    process.exit(1);
  }
})();
