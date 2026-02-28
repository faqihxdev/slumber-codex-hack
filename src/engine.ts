import { initGitHub, fetchIssues, mergePR, createIssue } from "./utils/github.js";
import { cleanupAllWorktrees, getWorktreePath } from "./utils/git.js";
import { triageIssue } from "./triage.js";
import { PriorityQueue } from "./queue.js";
import { resolveIssueStreamed } from "./swarm.js";
import { submitPR } from "./pr.js";
import { loadDirectives, watchDirectives } from "./directives.js";
import { processFeedback } from "./feedback.js";
import { ingestRepo } from "./ingester.js";
import { generateProposals, buildProposalIssueBody } from "./proposer.js";
import { bus } from "./events.js";
import type { LivingRepoConfig, Directives, TriagedIssue, PRResult } from "./types.js";

export async function runEngine(config: LivingRepoConfig): Promise<void> {
  bus.dispatch("init:start");

  initGitHub(config.githubToken);
  const directives = loadDirectives(config.repoPath);

  let repoContext: string | null = null;
  try {
    repoContext = await ingestRepo(config);
  } catch { /* non-fatal */ }

  bus.dispatch("init:done");

  const stopWatch = watchDirectives(config.repoPath, () => {});

  let currentDirectives = directives;

  try {
    await processFeedback(config);
  } catch { /* non-fatal */ }

  const rawIssues = await fetchIssues(config.repoOwner, config.repoName, "open");

  bus.dispatch("triage:start", { total: rawIssues.length });

  const triaged: TriagedIssue[] = [];
  for (const issue of rawIssues) {
    try {
      const t = await triageIssue(issue, config, repoContext || undefined);
      triaged.push(t);
      bus.dispatch("triage:issue", {
        issueId: t.issue_id,
        title: t.title,
        classification: t.classification,
        severity: t.severity,
      });
    } catch { /* skip */ }
    bus.dispatch("triage:progress", { done: triaged.length, total: rawIssues.length });
  }

  bus.dispatch("triage:done", { count: triaged.length });

  // Proactive builder: suggest one new feature and file it as a GitHub issue
  if (repoContext) {
    try {
      bus.dispatch("propose:start");
      const proposals = await generateProposals(config, repoContext, currentDirectives || undefined);
      const top = proposals[0];
      if (top) {
        const body = buildProposalIssueBody(top);
        const proposed = await createIssue(config.repoOwner, config.repoName, {
          title: top.title,
          body,
          labels: ["living-repo", "enhancement", `complexity-${top.complexity}`],
        });
        bus.dispatch("propose:issue_created", {
          issueNumber: proposed.number,
          issueUrl: proposed.html_url,
          title: top.title,
          priority: top.priority_score,
          complexity: top.complexity,
        });
      }
      bus.dispatch("propose:done", {
        count: top ? 1 : 0,
        proposals: top ? [{ title: top.title, priority: top.priority_score, complexity: top.complexity }] : [],
      });
    } catch { /* non-fatal */ }
  }

  const queue = new PriorityQueue();
  queue.addIssues(triaged, currentDirectives || undefined);
  bus.dispatch("queue:update", { queue: queue.getStatus() });

  const prsSubmitted: PRResult[] = [];

  while (queue.getStatus().pending > 0) {
    const freshDirectives = loadDirectives(config.repoPath);
    if (freshDirectives) {
      currentDirectives = freshDirectives;
      queue.reorder(freshDirectives);
    }

    const batch: TriagedIssue[] = [];
    for (let i = 0; i < config.maxConcurrency; i++) {
      const next = queue.pickNext();
      if (!next) break;
      batch.push(next.issue);
    }

    if (batch.length === 0) break;

    bus.dispatch("queue:update", { queue: queue.getStatus() });

    for (const issue of batch) {
      bus.dispatch("agent:start", {
        issueId: issue.issue_id,
        title: issue.title,
        classification: issue.classification,
        severity: issue.severity,
      });
    }

    const resolveOne = async (issue: TriagedIssue) => {
      bus.dispatch("agent:activity", { issueId: issue.issue_id, status: "exploring", activity: "Reading codebase..." });

      const result = await resolveIssueStreamed(
        issue,
        config,
        currentDirectives || undefined,
        (event) => {
          if (event.type === "item.completed") {
            const item = event.item;
            if (item.type === "command_execution") {
              const cmd = item.command
                .replace(/^"[^"]*[/\\](pwsh|powershell|bash|sh|cmd|node)\.exe"\s+(-\w+\s+)?/i, "")
                .replace(/^'|'$/g, "")
                .slice(0, 50);
              bus.dispatch("agent:activity", {
                issueId: issue.issue_id,
                status: "implementing",
                activity: `$ ${cmd}`,
              });
            } else if (item.type === "file_change") {
              const paths = item.changes.map((c: { kind: string; path: string }) =>
                c.path.split(/[/\\]/).pop()
              ).join(", ");
              bus.dispatch("agent:activity", {
                issueId: issue.issue_id,
                status: "implementing",
                activity: `Editing: ${paths}`,
              });
              bus.dispatch("agent:file_change", { issueId: issue.issue_id, files: paths });
            }
          }
        }
      );

      if (result.success && result.files_changed.length > 0) {
        bus.dispatch("agent:activity", { issueId: issue.issue_id, status: "pushing", activity: "Creating PR..." });
        try {
          const wtPath = getWorktreePath(config.repoPath, issue.issue_id);
          const pr = await submitPR(issue, result, config, wtPath);
          prsSubmitted.push(pr);
          queue.markCompleted(issue.issue_id);
          bus.dispatch("agent:done", { issueId: issue.issue_id, filesChanged: result.files_changed.length });
          bus.dispatch("pr:created", {
            issueId: issue.issue_id,
            prNumber: pr.pr_number,
            prUrl: pr.pr_url,
            title: pr.title,
          });

          bus.dispatch("agent:activity", { issueId: issue.issue_id, status: "pushing", activity: "Auto-merging PR..." });
          const mergeResult = await mergePR(config.repoOwner, config.repoName, pr.pr_number, "squash");
          if (mergeResult.merged) {
            pr.status = "merged";
            bus.dispatch("pr:merged", {
              issueId: issue.issue_id,
              prNumber: pr.pr_number,
              prUrl: pr.pr_url,
            });
          } else {
            bus.dispatch("pr:merge_failed", {
              issueId: issue.issue_id,
              prNumber: pr.pr_number,
              reason: mergeResult.message,
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          queue.markFailed(issue.issue_id, msg);
          bus.dispatch("agent:failed", { issueId: issue.issue_id, error: msg });
        }
      } else {
        queue.markFailed(issue.issue_id, result.error || "No changes made");
        bus.dispatch("agent:failed", { issueId: issue.issue_id, error: result.error || "No changes made" });
      }

      bus.dispatch("queue:update", { queue: queue.getStatus() });
    };

    await Promise.allSettled(batch.map(resolveOne));
  }

  bus.dispatch("loop:done");

  stopWatch();
  try {
    await cleanupAllWorktrees(config.repoPath);
  } catch { /* best effort */ }

  bus.close();
}
