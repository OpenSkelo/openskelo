import { mkdirSync, writeFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import chalk from "chalk";

const TEMPLATES: Record<string, string> = {
  coding: `# OpenSkelo Pipeline — Coding Template
# Edit this file to configure your agent pipeline.
# Docs: https://github.com/OpenSkelo/openskelo

name: my-pipeline

providers:
  - name: local
    type: ollama
    url: http://localhost:11434

agents:
  coder:
    role: worker
    capabilities: [coding]
    provider: local
    model: codellama:13b
    max_concurrent: 1

  reviewer:
    role: reviewer
    capabilities: [coding]
    provider: local
    model: llama3:8b
    max_concurrent: 1

pipelines:
  coding:
    stages:
      - name: PENDING
        transitions: [IN_PROGRESS, BLOCKED]
      - name: IN_PROGRESS
        route: { role: worker, capability: coding }
        transitions: [REVIEW, BLOCKED]
      - name: REVIEW
        route: { role: reviewer, capability: coding }
        transitions: [DONE, IN_PROGRESS]
      - name: DONE
        transitions: [ARCHIVED]
      - name: BLOCKED
        transitions: [PENDING, IN_PROGRESS]
      - name: ARCHIVED

gates:
  - name: needs-assignee
    on: { from: PENDING, to: IN_PROGRESS }
    check: { type: not_empty, field: assigned }
    error: "Assign an agent before starting work"

  - name: structured-feedback
    on: { from: REVIEW, to: IN_PROGRESS }
    check: { type: contains, field: notes, values: ["WHAT:", "WHERE:", "FIX:"] }
    error: "Bounce requires structured feedback (WHAT, WHERE, FIX)"

  - name: done-evidence
    on: { to: DONE }
    check: { type: min_length, field: notes, min: 10 }
    error: "Provide evidence of completion in notes"

  - name: max-bounces
    on: { to: IN_PROGRESS }
    check: { type: max_value, field: bounce_count, max: 5 }
    error: "Task exceeded max bounce limit — blocked for review"

storage: sqlite

dashboard:
  enabled: true
  port: 4040
`,

  research: `# OpenSkelo Pipeline — Research Template

name: my-research-pipeline

providers:
  - name: local
    type: ollama
    url: http://localhost:11434

agents:
  researcher:
    role: worker
    capabilities: [research]
    provider: local
    model: llama3:8b
    max_concurrent: 1

pipelines:
  research:
    stages:
      - name: PENDING
        transitions: [IN_PROGRESS]
      - name: IN_PROGRESS
        route: { role: worker, capability: research }
        transitions: [DONE, BLOCKED]
      - name: DONE
      - name: BLOCKED
        transitions: [PENDING]

gates:
  - name: needs-assignee
    on: { from: PENDING, to: IN_PROGRESS }
    check: { type: not_empty, field: assigned }
    error: "Assign an agent before starting work"

  - name: sources-required
    on: { to: DONE }
    check: { type: contains, field: notes, values: ["Sources:"] }
    error: "Research tasks must include a Sources section"

  - name: summary-length
    on: { to: DONE }
    check: { type: min_length, field: notes, min: 200 }
    error: "Research summary must be at least 200 characters"

storage: sqlite

dashboard:
  enabled: true
  port: 4040
`,

  content: `# OpenSkelo Pipeline — Content Template

name: my-content-pipeline

providers:
  - name: local
    type: ollama
    url: http://localhost:11434

agents:
  writer:
    role: worker
    capabilities: [content]
    provider: local
    model: llama3:8b
    max_concurrent: 1

  editor:
    role: reviewer
    capabilities: [content]
    provider: local
    model: llama3:8b
    max_concurrent: 1

pipelines:
  content:
    stages:
      - name: PENDING
        transitions: [IN_PROGRESS]
      - name: IN_PROGRESS
        route: { role: worker, capability: content }
        transitions: [REVIEW, BLOCKED]
      - name: REVIEW
        route: { role: reviewer, capability: content }
        transitions: [DONE, IN_PROGRESS]
      - name: DONE
      - name: BLOCKED
        transitions: [PENDING]

gates:
  - name: needs-assignee
    on: { from: PENDING, to: IN_PROGRESS }
    check: { type: not_empty, field: assigned }
    error: "Assign an agent before starting work"

  - name: editorial-feedback
    on: { from: REVIEW, to: IN_PROGRESS }
    check: { type: min_length, field: notes, min: 20 }
    error: "Editorial feedback must explain what needs revision"

  - name: done-evidence
    on: { to: DONE }
    check: { type: min_length, field: notes, min: 10 }
    error: "Provide evidence of completion"

storage: sqlite

dashboard:
  enabled: true
  port: 4040
`,

  custom: `# OpenSkelo Pipeline — Custom Template
# Configure your own pipeline from scratch.
# Docs: https://github.com/OpenSkelo/openskelo

name: my-pipeline

providers:
  - name: local
    type: ollama
    url: http://localhost:11434
  # - name: cloud
  #   type: openai
  #   env: OPENAI_API_KEY

agents:
  worker:
    role: worker
    capabilities: [general]
    provider: local
    model: llama3:8b
    max_concurrent: 1
  # reviewer:
  #   role: reviewer
  #   capabilities: [general]
  #   provider: local
  #   model: llama3:8b
  #   max_concurrent: 1

pipelines:
  default:
    stages:
      - name: PENDING
        transitions: [IN_PROGRESS]
      - name: IN_PROGRESS
        route: { role: worker, capability: general }
        transitions: [DONE]
      - name: DONE

gates: []
  # - name: my-gate
  #   on: { to: DONE }
  #   check: { type: min_length, field: notes, min: 10 }
  #   error: "Notes required to complete task"

storage: sqlite

dashboard:
  enabled: true
  port: 4040
`,
};

export async function initProject(name?: string, template: string = "coding") {
  const projectName = name ?? "my-skelo-pipeline";
  const dir = resolve(process.cwd(), projectName);

  if (existsSync(dir)) {
    console.error(chalk.red(`✗ Directory '${projectName}' already exists`));
    process.exit(1);
  }

  const templateContent = TEMPLATES[template];
  if (!templateContent) {
    console.error(chalk.red(`✗ Unknown template: '${template}'. Available: ${Object.keys(TEMPLATES).join(", ")}`));
    process.exit(1);
  }

  console.log(chalk.hex("#f97316")(`\n🦴 Creating OpenSkelo project: ${projectName}\n`));

  // Create directory structure
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".skelo"), { recursive: true });

  // Write config
  writeFileSync(join(dir, "skelo.yaml"), templateContent);

  // Write .gitignore
  writeFileSync(
    join(dir, ".gitignore"),
    `.skelo/\nnode_modules/\n.env\n.env.local\n`
  );

  // Write README
  writeFileSync(
    join(dir, "README.md"),
    `# ${projectName}\n\nPowered by [OpenSkelo](https://github.com/OpenSkelo/openskelo) — give your AI agents a backbone.\n\n## Quick Start\n\n\`\`\`bash\n# Start the pipeline\nnpx openskelo start\n\n# Create a task\nnpx openskelo task create --pipeline ${template} --title "My first task" --assign ${template === "research" ? "researcher" : template === "content" ? "writer" : "coder"}\n\n# Check status\nnpx openskelo status\n\`\`\`\n\nEdit \`skelo.yaml\` to customize your pipeline.\n`
  );

  console.log(chalk.green("  ✓ ") + "skelo.yaml" + chalk.dim(` (${template} template)`));
  console.log(chalk.green("  ✓ ") + ".gitignore");
  console.log(chalk.green("  ✓ ") + "README.md");

  console.log(chalk.hex("#f97316")(`\n🦴 Done! Next steps:\n`));
  console.log(chalk.dim(`  cd ${projectName}`));
  console.log(chalk.dim("  npx openskelo start"));
  console.log();
}
