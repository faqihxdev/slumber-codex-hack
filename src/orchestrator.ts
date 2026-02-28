import { logger } from "./utils/logger.js";
import { initGitHub, fetchIssues, getDefaultBranch } from "./utils/github.js";
import { cleanupAllWorktrees } from "./utils/git.js";
import { triageBatch, triageIssue } from "./triage.js";
import { PriorityQueue } from "./queue.js";
import { resolveIssue, resolveIssuesParallel, resolveIssueStreamed } from "./swarm.js";
import { submitPR } from "./pr.js";
import { loadDirectives, watchDirectives } from "./directives.js";
import { processFeedback } from "./feedback.js";
import { ingestRepo, generateSkills } from "./ingester.js";
import { generateProposals, writeRoadmap } from "./proposer.js";
import { getWorktreePath } from "./utils/git.js";
import {
  createDashboardState,
  render as renderDashboard,
  addAgent,
  updateAgentStatus,
  removeAgent,
  type DashboardState,
} from "./dashboard.js";
import type { LivingRepoConfig, Directives, PRResult, TriagedIssue } from "./types.js";

export type OrchestratorMode = "issue_crusher" | "proactive_builder" | "idle";

export interface OrchestratorState {
  mode: OrchestratorMode;
  queue: PriorityQueue;
  directives: Directives | null;
  repoContext: string | null;
  prsSubmitted: PRResult[];
  loopCount: number;
  running: boolean;
}

export async function initOrchestrator(
  config: LivingRepoConfig
): Promise<OrchestratorState> {
  logger.info("Orchestrator", "Initializing The Living Repo");

  initGitHub(config.githubToken);

  const directives = loadDirectives(config.repoPath);

  let repoContext: string | null = null;
  try {
    repoContext = await ingestRepo(config);
    await generateSkills(config, repoContext);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("Orchestrator", `Ingestion failed (non-fatal): ${msg}`);
  }

  return {
    mode: "issue_crusher",
    queue: new PriorityQueue(),
    directives,
    repoContext,
    prsSubmitted: [],
    loopCount: 0,
    running: false,
  };
}

export async function runOnce(
  state: OrchestratorState,
  config: LivingRepoConfig
): Promise<void> {
  state.loopCount++;
  logger.info(
    "Orchestrator",
    `━━━ Loop ${state.loopCount} ━━━ Mode: ${state.mode}`
  );

  // Reload directives each iteration
  const freshDirectives = loadDirectives(config.repoPath);
  if (freshDirectives) {
    state.directives = freshDirectives;
    state.queue.reorder(freshDirectives);
  }

  // Process feedback from reviewed PRs
  try {
    await processFeedback(config);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("Orchestrator", `Feedback processing failed: ${msg}`);
  }

  // Fetch and triage new issues
  const rawIssues = await fetchIssues(config.repoOwner, config.repoName, "open");

  if (rawIssues.length > 0) {
    state.mode = "issue_crusher";
    const triaged = await triageBatch(
      rawIssues,
      config,
      state.repoContext || undefined
    );
    state.queue.addIssues(triaged, state.directives || undefined);
  } else {
    state.mode = "proactive_builder";
  }

  const status = state.queue.getStatus();
  logger.info("Orchestrator", "Queue status", status);

  if (state.mode === "issue_crusher" && status.pending > 0) {
    await crushIssues(state, config);
  } else if (state.mode === "proactive_builder") {
    await proposeFeatures(state, config);
  } else {
    logger.info("Orchestrator", "Nothing to do this loop");
  }
}

async function crushIssues(
  state: OrchestratorState,
  config: LivingRepoConfig
): Promise<void> {
  const batch: typeof state.queue.pending = [];

  for (let i = 0; i < config.maxConcurrency; i++) {
    const next = state.queue.pickNext();
    if (!next) break;
    batch.push(next);
  }

  if (batch.length === 0) {
    logger.info("Orchestrator", "No issues ready to process");
    return;
  }

  logger.info("Orchestrator", `Processing ${batch.length} issues`);

  const issues = batch.map((b) => b.issue);

  if (batch.length === 1) {
    const result = await resolveIssue(
      issues[0],
      config,
      state.directives || undefined
    );

    if (result.success && result.files_changed.length > 0) {
      try {
        const wtPath = getWorktreePath(config.repoPath, issues[0].issue_id);
        const pr = await submitPR(issues[0], result, config, wtPath);
        state.prsSubmitted.push(pr);
        state.queue.markCompleted(issues[0].issue_id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        state.queue.markFailed(issues[0].issue_id, msg);
      }
    } else {
      state.queue.markFailed(issues[0].issue_id, result.error || "No changes made");
    }
  } else {
    const results = await resolveIssuesParallel(
      issues,
      config,
      state.directives || undefined,
      { maxConcurrency: config.maxConcurrency }
    );

    for (const result of results) {
      const issue = issues.find((i) => i.issue_id === result.issue_id);
      if (!issue) continue;

      if (result.success && result.files_changed.length > 0) {
        try {
          const wtPath = getWorktreePath(config.repoPath, result.issue_id);
          const pr = await submitPR(issue, result, config, wtPath);
          state.prsSubmitted.push(pr);
          state.queue.markCompleted(result.issue_id);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          state.queue.markFailed(result.issue_id, msg);
        }
      } else {
        state.queue.markFailed(
          result.issue_id,
          result.error || "No changes made"
        );
      }
    }
  }
}

async function proposeFeatures(
  state: OrchestratorState,
  config: LivingRepoConfig
): Promise<void> {
  if (!state.repoContext) {
    logger.warn("Orchestrator", "No repo context — skipping proposals");
    return;
  }

  logger.info("Orchestrator", "Entering Proactive Builder mode");

  try {
    const proposals = await generateProposals(
      config,
      state.repoContext,
      state.directives || undefined
    );
    writeRoadmap(config.repoPath, proposals);
    logger.success(
      "Orchestrator",
      `Generated ${proposals.length} feature proposals`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Orchestrator", `Proposal generation failed: ${msg}`);
  }
}

export async function runLoop(
  config: LivingRepoConfig,
  intervalMs: number = 60_000
): Promise<void> {
  const state = await initOrchestrator(config);
  state.running = true;

  const stopDirectivesWatch = watchDirectives(
    config.repoPath,
    (directives) => {
      state.directives = directives;
      state.queue.reorder(directives);
    }
  );

  logger.info("Orchestrator", "Starting main loop");

  try {
    while (state.running) {
      await runOnce(state, config);

      const status = state.queue.getStatus();
      if (status.pending === 0 && status.in_progress === 0) {
        logger.info(
          "Orchestrator",
          "All issues processed. Waiting for new issues..."
        );
      }

      await new Promise((r) => setTimeout(r, intervalMs));
    }
  } finally {
    stopDirectivesWatch();
    try {
      await cleanupAllWorktrees(config.repoPath);
    } catch {
      // best effort cleanup
    }
  }
}

export async function runLoopWithDashboard(
  config: LivingRepoConfig,
  intervalMs: number = 60_000
): Promise<void> {
  const dash = createDashboardState();
  dash.mode = "initializing";
  renderDashboard(dash);

  const state = await initOrchestrator(config);
  state.running = true;

  const stopDirectivesWatch = watchDirectives(config.repoPath, (directives) => {
    state.directives = directives;
    state.queue.reorder(directives);
  });

  dash.mode = "issue_crusher";
  renderDashboard(dash);

  try {
    while (state.running) {
      state.loopCount++;
      dash.loopCount = state.loopCount;
      dash.mode = state.mode;

      const freshDirectives = loadDirectives(config.repoPath);
      if (freshDirectives) {
        state.directives = freshDirectives;
        state.queue.reorder(freshDirectives);
      }

      try { await processFeedback(config); } catch { /* non-fatal */ }

      const rawIssues = await fetchIssues(config.repoOwner, config.repoName, "open");

      if (rawIssues.length > 0) {
        state.mode = "issue_crusher";
        dash.mode = "issue_crusher";
        dash.triageProgress = { done: 0, total: rawIssues.length };
        renderDashboard(dash);

        const triaged: TriagedIssue[] = [];
        for (const issue of rawIssues) {
          try {
            const t = await triageIssue(issue, config, state.repoContext || undefined);
            triaged.push(t);
          } catch { /* skip */ }
          dash.triageProgress.done++;
          renderDashboard(dash);
        }
        dash.metrics.issuesTriaged = triaged.length;
        state.queue.addIssues(triaged, state.directives || undefined);
      } else {
        state.mode = "proactive_builder";
        dash.mode = "proactive_builder";
      }

      const status = state.queue.getStatus();
      dash.queue = status;
      renderDashboard(dash);

      if (state.mode === "issue_crusher" && status.pending > 0) {
        await crushIssuesWithDashboard(state, config, dash);
      }

      dash.queue = state.queue.getStatus();
      dash.prs = state.prsSubmitted;
      dash.metrics.issuesResolved = state.queue.getStatus().completed;
      dash.metrics.prsCreated = state.prsSubmitted.length;
      renderDashboard(dash);

      if (state.queue.getStatus().pending === 0) {
        state.running = false;
      } else {
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }
  } finally {
    stopDirectivesWatch();
    try { await cleanupAllWorktrees(config.repoPath); } catch { /* best effort */ }
  }
}

async function crushIssuesWithDashboard(
  state: OrchestratorState,
  config: LivingRepoConfig,
  dash: DashboardState
): Promise<void> {
  const batch: ReturnType<typeof state.queue.pickNext>[] = [];
  for (let i = 0; i < config.maxConcurrency; i++) {
    const next = state.queue.pickNext();
    if (!next) break;
    batch.push(next);
  }

  if (batch.length === 0) return;

  const issues = batch.filter((b): b is NonNullable<typeof b> => b !== null).map((b) => b.issue);

  for (const issue of issues) {
    addAgent(dash, issue);
  }
  dash.queue = state.queue.getStatus();
  renderDashboard(dash);

  const resolveOne = async (issue: TriagedIssue) => {
    updateAgentStatus(dash, issue.issue_id, "exploring", "Reading codebase...");
    renderDashboard(dash);

    const result = await resolveIssueStreamed(
      issue,
      config,
      state.directives || undefined,
      (event) => {
        if (event.type === "item.completed") {
          const item = event.item;
          if (item.type === "command_execution") {
            updateAgentStatus(dash, issue.issue_id, "implementing", `$ ${item.command.slice(0, 60)}`);
          } else if (item.type === "file_change") {
            const paths = item.changes.map((c: { kind: string; path: string }) => c.path.split("/").pop()).join(", ");
            updateAgentStatus(dash, issue.issue_id, "implementing", `Editing: ${paths}`);
          }
          renderDashboard(dash);
        }
      }
    );

    if (result.success && result.files_changed.length > 0) {
      updateAgentStatus(dash, issue.issue_id, "pushing", "Creating PR...");
      renderDashboard(dash);
      try {
        const wtPath = getWorktreePath(config.repoPath, issue.issue_id);
        const pr = await submitPR(issue, result, config, wtPath);
        state.prsSubmitted.push(pr);
        state.queue.markCompleted(issue.issue_id);
        updateAgentStatus(dash, issue.issue_id, "done", `PR #${pr.pr_number}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        state.queue.markFailed(issue.issue_id, msg);
        updateAgentStatus(dash, issue.issue_id, "failed", msg.slice(0, 60));
      }
    } else {
      state.queue.markFailed(issue.issue_id, result.error || "No changes made");
      updateAgentStatus(dash, issue.issue_id, "failed", result.error || "No changes");
    }

    dash.queue = state.queue.getStatus();
    dash.prs = state.prsSubmitted;
    dash.metrics.issuesResolved = state.queue.getStatus().completed;
    dash.metrics.prsCreated = state.prsSubmitted.length;
    renderDashboard(dash);

    setTimeout(() => {
      removeAgent(dash, issue.issue_id);
      renderDashboard(dash);
    }, 3000);
  };

  await Promise.allSettled(issues.map(resolveOne));
}

export async function triageOnly(config: LivingRepoConfig): Promise<void> {
  initGitHub(config.githubToken);

  let repoContext: string | null = null;
  try {
    repoContext = await ingestRepo(config);
  } catch {
    // non-fatal
  }

  const rawIssues = await fetchIssues(config.repoOwner, config.repoName, "open");
  const triaged = await triageBatch(rawIssues, config, repoContext || undefined);

  const directives = loadDirectives(config.repoPath);
  const queue = new PriorityQueue();
  queue.addIssues(triaged, directives || undefined);

  console.log("\n" + "━".repeat(60));
  console.log("TRIAGE RESULTS");
  console.log("━".repeat(60));

  for (const item of queue.getAll()) {
    const i = item.issue;
    console.log(
      `\n#${i.issue_id} [${i.classification}/${i.severity}/${i.complexity}] (score: ${item.priority_score})`
    );
    console.log(`  ${i.title}`);
    console.log(`  Approach: ${i.approach}`);
    console.log(`  Files: ${i.relevant_files.join(", ")}`);
    console.log(`  Confidence: ${i.confidence}`);
  }

  console.log("\n" + "━".repeat(60));
  console.log(`Total: ${queue.length} issues triaged`);
  console.log("━".repeat(60));
}
