import { mkdirSync, writeFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import chalk from "chalk";

interface InitTemplate {
  config: string;
  dagFile: string;
  dag: string;
}

const TEMPLATES: Record<string, InitTemplate> = {
  coding: {
    config: `# OpenSkelo Project Config (v2 DAG-first)
name: my-pipeline

providers:
  - name: local
    type: ollama
    url: http://localhost:11434

agents:
  manager:
    role: manager
    capabilities: [planning]
    provider: local
    model: llama3:8b
    max_concurrent: 1

  worker:
    role: worker
    capabilities: [coding, testing]
    provider: local
    model: codellama:13b
    max_concurrent: 1

  reviewer:
    role: reviewer
    capabilities: [qa]
    provider: local
    model: llama3:8b
    max_concurrent: 1

storage: sqlite

dashboard:
  enabled: true
  port: 4040
`,
    dagFile: "coding.yaml",
    dag: `name: coding

blocks:
  - id: plan
    name: Plan
    inputs:
      prompt: string
    outputs:
      plan: string
    agent:
      role: manager
    pre_gates: []
    post_gates:
      - name: plan-not-empty
        check: { type: port_not_empty, port: plan }
        error: Plan is required
    retry:
      max_attempts: 0
      backoff: none
      delay_ms: 0

  - id: build
    name: Build
    inputs:
      plan: string
    outputs:
      code: artifact
    agent:
      role: worker
      capability: coding
    pre_gates: []
    post_gates:
      - name: has-code
        check: { type: port_not_empty, port: code }
        error: Build must produce code
    retry:
      max_attempts: 1
      backoff: linear
      delay_ms: 1000

  - id: review
    name: Review
    inputs:
      code: artifact
    outputs:
      approved: boolean
      feedback: string
    agent:
      role: reviewer
      capability: qa
    pre_gates: []
    post_gates:
      - name: approval-type
        check: { type: port_type, port: approved, expected: boolean }
        error: Review must return boolean approved
    retry:
      max_attempts: 0
      backoff: none
      delay_ms: 0

edges:
  - { from: plan, output: plan, to: build, input: plan }
  - { from: build, output: code, to: review, input: code }
`,
  },

  research: {
    config: `# OpenSkelo Project Config (v2 DAG-first)
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

  reviewer:
    role: reviewer
    capabilities: [research]
    provider: local
    model: llama3:8b
    max_concurrent: 1

storage: sqlite

dashboard:
  enabled: true
  port: 4040
`,
    dagFile: "research.yaml",
    dag: `name: research

blocks:
  - id: gather
    name: Gather Sources
    inputs:
      prompt: string
    outputs:
      sources: json
      findings: string
    agent:
      specific: researcher
    pre_gates: []
    post_gates:
      - name: has-sources
        check: { type: port_not_empty, port: sources }
        error: Sources are required
    retry:
      max_attempts: 1
      backoff: none
      delay_ms: 0

  - id: synthesize
    name: Synthesize
    inputs:
      findings: string
      sources: json
    outputs:
      summary: string
    agent:
      specific: researcher
    pre_gates: []
    post_gates:
      - name: summary-len
        check: { type: port_min_length, port: summary, min: 120 }
        error: Summary must be at least 120 chars
    retry:
      max_attempts: 0
      backoff: none
      delay_ms: 0

  - id: verify
    name: Verify
    inputs:
      summary: string
      sources: json
    outputs:
      approved: boolean
      notes: string
    agent:
      specific: reviewer
    pre_gates: []
    post_gates:
      - name: has-verdict
        check: { type: port_type, port: approved, expected: boolean }
        error: Verification must set approved
    retry:
      max_attempts: 0
      backoff: none
      delay_ms: 0

edges:
  - { from: gather, output: findings, to: synthesize, input: findings }
  - { from: gather, output: sources, to: synthesize, input: sources }
  - { from: synthesize, output: summary, to: verify, input: summary }
  - { from: gather, output: sources, to: verify, input: sources }
`,
  },

  content: {
    config: `# OpenSkelo Project Config (v2 DAG-first)
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

storage: sqlite

dashboard:
  enabled: true
  port: 4040
`,
    dagFile: "content.yaml",
    dag: `name: content

blocks:
  - id: draft
    name: Draft
    inputs:
      prompt: string
    outputs:
      draft: string
    agent:
      specific: writer
    pre_gates: []
    post_gates:
      - name: draft-min
        check: { type: port_min_length, port: draft, min: 120 }
        error: Draft is too short
    retry:
      max_attempts: 1
      backoff: none
      delay_ms: 0

  - id: edit
    name: Edit
    inputs:
      draft: string
    outputs:
      approved: boolean
      feedback: string
      final: string
    agent:
      specific: editor
    pre_gates: []
    post_gates:
      - name: has-approval
        check: { type: port_type, port: approved, expected: boolean }
        error: Edit step must set approval
    retry:
      max_attempts: 0
      backoff: none
      delay_ms: 0

edges:
  - { from: draft, output: draft, to: edit, input: draft }
`,
  },

  custom: {
    config: `# OpenSkelo Project Config (v2 DAG-first)
name: my-pipeline

providers:
  - name: local
    type: ollama
    url: http://localhost:11434

agents:
  worker:
    role: worker
    capabilities: [general]
    provider: local
    model: llama3:8b
    max_concurrent: 1

storage: sqlite

dashboard:
  enabled: true
  port: 4040
`,
    dagFile: "custom.yaml",
    dag: `name: custom

blocks:
  - id: step1
    name: Step 1
    inputs:
      prompt: string
    outputs:
      result: string
    agent:
      specific: worker
    pre_gates: []
    post_gates:
      - name: has-result
        check: { type: port_not_empty, port: result }
        error: Result is required
    retry:
      max_attempts: 0
      backoff: none
      delay_ms: 0

edges: []
`,
  },
};

export async function initProject(name?: string, template: string = "coding", opts?: { cwd?: string }) {
  const projectName = name ?? "my-skelo-pipeline";
  const baseDir = opts?.cwd ?? process.cwd();
  const dir = resolve(baseDir, projectName);

  if (existsSync(dir)) {
    console.error(chalk.red(`✗ Directory '${projectName}' already exists`));
    process.exit(1);
  }

  const selected = TEMPLATES[template];
  if (!selected) {
    console.error(chalk.red(`✗ Unknown template: '${template}'. Available: ${Object.keys(TEMPLATES).join(", ")}`));
    process.exit(1);
  }

  console.log(chalk.hex("#f97316")(`\n🦴 Creating OpenSkelo project: ${projectName}\n`));

  // Create directory structure
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".skelo"), { recursive: true });
  mkdirSync(join(dir, "examples"), { recursive: true });

  // Write project config + starter DAG
  writeFileSync(join(dir, "skelo.yaml"), selected.config);
  writeFileSync(join(dir, "examples", selected.dagFile), selected.dag);

  // Write .gitignore
  writeFileSync(
    join(dir, ".gitignore"),
    `.skelo/\nnode_modules/\n.env\n.env.local\n`
  );

  // Write README
  writeFileSync(
    join(dir, "README.md"),
    `# ${projectName}\n\nPowered by [OpenSkelo](https://github.com/OpenSkelo/openskelo) — give your AI agents a backbone.\n\n## Quick Start\n\n\`\`\`bash\n# Start runtime + dashboard\nnpx openskelo start\n\n# In another terminal, start a DAG run\nnpx openskelo run examples/${selected.dagFile} --input prompt="hello"\n\n# Check run status\nnpx openskelo run list\n\`\`\`\n\n- Project config: \`skelo.yaml\`\n- Starter DAG: \`examples/${selected.dagFile}\`\n\nThis project uses v2 DAG-first templates.\n`
  );

  console.log(chalk.green("  ✓ ") + "skelo.yaml" + chalk.dim(" (project config)"));
  console.log(chalk.green("  ✓ ") + `examples/${selected.dagFile}` + chalk.dim(" (DAG template)"));
  console.log(chalk.green("  ✓ ") + ".gitignore");
  console.log(chalk.green("  ✓ ") + "README.md");

  console.log(chalk.hex("#f97316")(`\n🦴 Done! Next steps:\n`));
  console.log(chalk.dim(`  cd ${projectName}`));
  console.log(chalk.dim("  npx openskelo start"));
  console.log(chalk.dim(`  npx openskelo run examples/${selected.dagFile} --input prompt=\"hello\"`));
  console.log();
}
