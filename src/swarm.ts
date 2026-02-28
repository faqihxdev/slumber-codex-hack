import { Codex, type ThreadItem, type ThreadEvent } from "@openai/codex-sdk";
import { logger } from "./utils/logger.js";
import {
  createWorktree,
  deleteWorktree,
  getChangedFiles,
  commitAll,
  getBranchName,
} from "./utils/git.js";
import { buildSingleAgentPrompt } from "./prompts.js";
import type {
  TriagedIssue,
  WorkerResult,
  LivingRepoConfig,
  Directives,
} from "./types.js";

let codex: Codex;

function getCodex(config: LivingRepoConfig): Codex {
  if (!codex) {
    codex = new Codex({ apiKey: config.openaiApiKey });
  }
  return codex;
}

export interface SwarmOptions {
  maxConcurrency: number;
  agentTimeoutMs: number;
}

const DEFAULT_OPTIONS: SwarmOptions = {
  maxConcurrency: 3,
  agentTimeoutMs: 10 * 60 * 1000,
};

function extractSummaryFromItems(items: ThreadItem[]): string {
  const parts: string[] = [];

  for (const item of items) {
    switch (item.type) {
      case "agent_message":
        parts.push(item.text);
        break;
      case "command_execution":
        parts.push(`[cmd] ${item.command} → exit ${item.exit_code ?? "running"}`);
        break;
      case "file_change":
        for (const c of item.changes) {
          parts.push(`[${c.kind}] ${c.path}`);
        }
        break;
      case "error":
        parts.push(`[error] ${item.message}`);
        break;
    }
  }

  return parts.join("\n").slice(0, 3000);
}

function extractChangedFilesFromItems(items: ThreadItem[]): string[] {
  const files = new Set<string>();
  for (const item of items) {
    if (item.type === "file_change") {
      for (const c of item.changes) {
        files.add(c.path);
      }
    }
  }
  return [...files];
}

export async function resolveIssue(
  issue: TriagedIssue,
  config: LivingRepoConfig,
  directives?: Directives
): Promise<WorkerResult> {
  const issueId = issue.issue_id;
  let worktreePath: string | null = null;

  try {
    worktreePath = await createWorktree(config.repoPath, issueId);
    const sdk = getCodex(config);

    const thread = sdk.startThread({
      model: config.codexModel,
      sandboxMode: "danger-full-access",
      workingDirectory: worktreePath,
      approvalPolicy: "never",
      modelReasoningEffort: "high",
    });

    const prompt = buildSingleAgentPrompt(issue, directives);

    logger.agent("Swarm", `Starting Codex agent for issue #${issueId} in ${worktreePath}`);

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      config.agentTimeout
    );

    let turn;
    try {
      turn = await thread.run(prompt, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    logger.info("Swarm", `Agent returned ${turn.items.length} items for issue #${issueId}`);
    for (const item of turn.items) {
      logger.info("Swarm", `  [${item.type}] ${item.type === "agent_message" ? item.text.slice(0, 200) : item.type === "command_execution" ? item.command : item.type === "file_change" ? item.changes.map((c: { kind: string; path: string }) => `${c.kind}:${c.path}`).join(", ") : item.type === "error" ? item.message : ""}`);
    }

    const itemSummary = extractSummaryFromItems(turn.items);
    const sdkChangedFiles = extractChangedFilesFromItems(turn.items);

    const gitChangedFiles = await getChangedFiles(worktreePath);
    const allChangedFiles = [...new Set([...sdkChangedFiles, ...gitChangedFiles])];

    if (allChangedFiles.length > 0) {
      await commitAll(
        worktreePath,
        `fix: resolve issue #${issueId} — ${issue.title}`
      );
    }

    logger.success("Swarm", `Agent completed for issue #${issueId}: ${allChangedFiles.length} files changed`);

    if (turn.usage) {
      logger.info("Swarm", `Tokens — in: ${turn.usage.input_tokens}, out: ${turn.usage.output_tokens}, cached: ${turn.usage.cached_input_tokens}`);
    }

    return {
      issue_id: issueId,
      success: allChangedFiles.length > 0,
      branch_name: getBranchName(issueId),
      files_changed: allChangedFiles,
      summary: `${turn.finalResponse}\n\n---\n${itemSummary}`.slice(0, 4000),
      confidence: allChangedFiles.length > 0 ? "medium" : "low",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Swarm", `Failed to resolve issue #${issueId}: ${msg}`);
    return {
      issue_id: issueId,
      success: false,
      branch_name: getBranchName(issueId),
      files_changed: [],
      summary: msg,
      confidence: "low",
      error: msg,
    };
  }
}

export async function resolveIssueStreamed(
  issue: TriagedIssue,
  config: LivingRepoConfig,
  directives?: Directives,
  onEvent?: (event: ThreadEvent) => void
): Promise<WorkerResult> {
  const issueId = issue.issue_id;
  let worktreePath: string | null = null;

  try {
    worktreePath = await createWorktree(config.repoPath, issueId);
    const sdk = getCodex(config);

    const thread = sdk.startThread({
      model: config.codexModel,
      sandboxMode: "danger-full-access",
      workingDirectory: worktreePath,
      approvalPolicy: "never",
      modelReasoningEffort: "high",
    });

    const prompt = buildSingleAgentPrompt(issue, directives);

    logger.agent("Swarm", `Starting streamed Codex agent for issue #${issueId}`);

    const { events } = await thread.runStreamed(prompt);
    const collectedItems: ThreadItem[] = [];

    for await (const event of events) {
      if (onEvent) onEvent(event);

      if (event.type === "item.completed") {
        collectedItems.push(event.item);

        if (event.item.type === "command_execution") {
          logger.agent("Swarm", `[#${issueId}] $ ${event.item.command} → exit ${event.item.exit_code}`);
        } else if (event.item.type === "file_change") {
          const paths = event.item.changes.map((c) => `${c.kind}: ${c.path}`).join(", ");
          logger.agent("Swarm", `[#${issueId}] Files: ${paths}`);
        }
      }
    }

    const sdkChangedFiles = extractChangedFilesFromItems(collectedItems);
    const gitChangedFiles = await getChangedFiles(worktreePath);
    const allChangedFiles = [...new Set([...sdkChangedFiles, ...gitChangedFiles])];

    if (allChangedFiles.length > 0) {
      await commitAll(
        worktreePath,
        `fix: resolve issue #${issueId} — ${issue.title}`
      );
    }

    const summary = extractSummaryFromItems(collectedItems);

    return {
      issue_id: issueId,
      success: allChangedFiles.length > 0,
      branch_name: getBranchName(issueId),
      files_changed: allChangedFiles,
      summary,
      confidence: allChangedFiles.length > 0 ? "medium" : "low",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Swarm", `Failed to resolve issue #${issueId}: ${msg}`);
    return {
      issue_id: issueId,
      success: false,
      branch_name: getBranchName(issueId),
      files_changed: [],
      summary: msg,
      confidence: "low",
      error: msg,
    };
  }
}

export async function resolveIssuesParallel(
  issues: TriagedIssue[],
  config: LivingRepoConfig,
  directives?: Directives,
  options: Partial<SwarmOptions> = {}
): Promise<WorkerResult[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  logger.info(
    "Swarm",
    `Starting parallel resolution: ${issues.length} issues, max concurrency ${opts.maxConcurrency}`
  );

  const results: WorkerResult[] = [];
  const issueQueue = [...issues];
  const active = new Set<number>();

  async function processNext(): Promise<void> {
    while (issueQueue.length > 0) {
      if (active.size >= opts.maxConcurrency) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }

      const issue = issueQueue.shift();
      if (!issue) break;

      active.add(issue.issue_id);
      logger.info(
        "Swarm",
        `[${active.size}/${opts.maxConcurrency}] Starting issue #${issue.issue_id}`
      );

      try {
        const result = await resolveIssue(issue, config, directives);
        results.push(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({
          issue_id: issue.issue_id,
          success: false,
          branch_name: getBranchName(issue.issue_id),
          files_changed: [],
          summary: msg,
          confidence: "low",
          error: msg,
        });
      } finally {
        active.delete(issue.issue_id);
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(opts.maxConcurrency, issues.length) },
    () => processNext()
  );
  await Promise.allSettled(workers);

  logger.success(
    "Swarm",
    `Completed: ${results.filter((r) => r.success).length}/${results.length} successful`
  );
  return results;
}
