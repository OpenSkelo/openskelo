#!/usr/bin/env node

const {
  GITHUB_TOKEN,
  ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL = "claude-sonnet-4-5",
  GITHUB_REPOSITORY,
  PR_NUMBER,
  COMMENT_AUTHOR,
  COMMENT_BODY = "",
  MAX_DIALOGUE_ROUNDS = "5",
} = process.env;

if (!GITHUB_TOKEN) fail("Missing GITHUB_TOKEN");
if (!ANTHROPIC_API_KEY) fail("Missing ANTHROPIC_API_KEY");
if (!GITHUB_REPOSITORY) fail("Missing GITHUB_REPOSITORY");
if (!PR_NUMBER) fail("Missing PR_NUMBER");

const [owner, repo] = GITHUB_REPOSITORY.split("/");
const maxRounds = Number(MAX_DIALOGUE_ROUNDS) || 5;
const marker = "<!-- REVIEW_DIALOGUE -->";

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

async function listReviews() {
  return gh(`/repos/${owner}/${repo}/pulls/${PR_NUMBER}/reviews?per_page=100`);
}

async function listFiles() {
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

async function postComment(body) {
  await gh(`/repos/${owner}/${repo}/issues/${PR_NUMBER}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

function extractJson(text) {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0 || e <= s) throw new Error("Model did not return JSON");
  return JSON.parse(text.slice(s, e + 1));
}

async function callAnthropic(payload) {
  const system = [
    "You are a collaborative code reviewer helping resolve a PR discussion.",
    "Keep it concise and practical.",
    "Return ONLY JSON with schema:",
    "{",
    '  \"stance\": \"accept|partial|disagree\",',
    '  \"response\": \"markdown string replying to the commenter\",',
    '  \"revised_required_fixes\": [\"string\"],',
    '  \"autofix_ready\": true|false',
    "}",
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
      max_tokens: 1200,
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
  return extractJson(text);
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

(async () => {
  try {
    const comments = await listIssueComments();
    const rounds = comments.filter((c) => (c.body || "").includes(marker)).length;
    const nextRound = rounds + 1;

    if (nextRound > maxRounds) {
      await postComment([
        marker,
        "🛑 Dialogue cap reached (5 rounds).",
        "Please settle this outside the PR and push the chosen changes.",
      ].join("\n\n"));
      process.exit(0);
    }

    const reviews = await listReviews();
    const latestReview = [...reviews]
      .reverse()
      .find((r) => ["CHANGES_REQUESTED", "COMMENTED"].includes(r.state) && ["github-actions", "github-actions[bot]"].includes(r.author?.login || ""));

    const files = await listFiles();

    const payload = {
      pr_number: Number(PR_NUMBER),
      comment_author: COMMENT_AUTHOR,
      commenter_feedback: COMMENT_BODY,
      latest_ai_review_summary: latestReview?.body || "No prior AI review found.",
      changed_files: files.map((f) => ({ filename: f.filename, additions: f.additions, deletions: f.deletions })),
    };

    const out = await callAnthropic(payload);
    const fixes = Array.isArray(out.revised_required_fixes) ? out.revised_required_fixes : [];

    await postComment([
      marker,
      `🤝 **Reviewer dialogue (${nextRound}/${maxRounds})**`,
      String(out.response || "Thanks — noted."),
      "\n**Revised required fixes**",
      fixes.length ? fixes.map((x) => `- ${x}`).join("\n") : "- None",
      out.autofix_ready ? "\n✅ Autofix-ready: yes (ask with `/autofix` once supported)." : "\n⚠️ Autofix-ready: no (manual change likely needed).",
    ].join("\n\n"));
  } catch (err) {
    await postComment([
      marker,
      "⚠️ Reviewer dialogue failed.",
      `Error: ${err instanceof Error ? err.message : String(err)}`,
    ].join("\n\n"));
    process.exit(1);
  }
})();
