import { Codex } from "@openai/codex-sdk";
import { logger } from "./utils/logger.js";
import type { LivingRepoConfig, TriagedIssue } from "./types.js";
import { TriagedIssueSchema } from "./types.js";
import type { RawGitHubIssue } from "./utils/github.js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const triageJsonSchema = require("./schemas/triage.json");

let codex: Codex;

function getCodex(config: LivingRepoConfig): Codex {
  if (!codex) {
    codex = new Codex({ apiKey: config.openaiApiKey });
  }
  return codex;
}

function buildTriagePrompt(issue: RawGitHubIssue, repoContext?: string): string {
  const labelNames = issue.labels
    .map((l) => (typeof l === "string" ? l : l.name || ""))
    .filter(Boolean);

  return `You are an expert software engineer triaging GitHub issues for an autonomous coding agent.

Classify this issue and return structured JSON.

Rules:
- classification: bug, feature, refactor, docs, test, or chore
- severity: critical (security/data loss), high (broken feature), medium (degraded experience), low (cosmetic/minor)
- complexity: S (1 file change), M (2-5 files), L (6+ files or architectural)
- relevant_files: your best guess at which files need changes (use full paths from repo root)
- dependencies: issue numbers that must be resolved first (empty array if none)
- approach: 2-3 sentence plan for resolving this issue
- confidence: high (clear problem + clear solution), medium (clear problem, uncertain solution), low (unclear problem)

**Issue #${issue.number}**: ${issue.title}
**Labels**: ${labelNames.join(", ") || "none"}
**Body**:
${issue.body || "(no body)"}

${repoContext ? `**Repository context**:\n${repoContext}` : ""}

Return JSON with fields: issue_id (set to ${issue.number}), title, classification, severity, complexity, relevant_files, dependencies, approach, confidence.`;
}

export async function triageIssue(
  issue: RawGitHubIssue,
  config: LivingRepoConfig,
  repoContext?: string
): Promise<TriagedIssue> {
  const sdk = getCodex(config);

  logger.info("Triage", `Classifying issue #${issue.number}: ${issue.title}`);

  const thread = sdk.startThread({
    model: config.codexModel,
    sandboxMode: "read-only",
    workingDirectory: config.repoPath,
    approvalPolicy: "never",
  });

  const prompt = buildTriagePrompt(issue, repoContext);
  const turn = await thread.run(prompt, {
    outputSchema: triageJsonSchema,
  });

  const raw = turn.finalResponse;
  if (!raw) {
    throw new Error(`Empty response from Codex for issue #${issue.number}`);
  }

  const parsed = JSON.parse(raw);
  parsed.issue_id = issue.number;
  parsed.title = issue.title;

  const validated = TriagedIssueSchema.parse(parsed);
  logger.success(
    "Triage",
    `Issue #${validated.issue_id}: ${validated.classification}/${validated.severity}/${validated.complexity} — ${validated.confidence} confidence`
  );

  return validated;
}

export async function triageBatch(
  issues: RawGitHubIssue[],
  config: LivingRepoConfig,
  repoContext?: string
): Promise<TriagedIssue[]> {
  logger.info("Triage", `Triaging ${issues.length} issues`);

  const results: TriagedIssue[] = [];
  const errors: Array<{ issueId: number; error: string }> = [];

  for (const issue of issues) {
    try {
      const triaged = await triageIssue(issue, config, repoContext);
      results.push(triaged);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Triage", `Failed to triage issue #${issue.number}: ${msg}`);
      errors.push({ issueId: issue.number, error: msg });
    }
  }

  logger.success(
    "Triage",
    `Triaged ${results.length}/${issues.length} issues (${errors.length} errors)`
  );

  return results;
}
