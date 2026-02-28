import { logger } from "./utils/logger.js";
import type { TriagedIssue, QueueItem, Directives } from "./types.js";
import { SEVERITY_WEIGHTS } from "./types.js";

export class PriorityQueue {
  private items: QueueItem[] = [];

  get length(): number {
    return this.items.length;
  }

  get pending(): QueueItem[] {
    return this.items.filter((i) => i.status === "pending");
  }

  get inProgress(): QueueItem[] {
    return this.items.filter((i) => i.status === "in_progress");
  }

  get completed(): QueueItem[] {
    return this.items.filter((i) => i.status === "completed");
  }

  get failed(): QueueItem[] {
    return this.items.filter((i) => i.status === "failed");
  }

  getAll(): QueueItem[] {
    return [...this.items];
  }

  addIssues(issues: TriagedIssue[], directives?: Directives): void {
    for (const issue of issues) {
      const existing = this.items.find(
        (i) => i.issue.issue_id === issue.issue_id
      );
      if (existing) continue;

      const score = this.calculatePriority(issue, directives);
      this.items.push({
        issue,
        priority_score: score,
        status: "pending",
      });
    }

    this.sort();
    logger.info("Queue", `Queue has ${this.pending.length} pending items`);
  }

  private calculatePriority(
    issue: TriagedIssue,
    directives?: Directives
  ): number {
    const severityWeight = SEVERITY_WEIGHTS[issue.severity];

    // Recency bonus: issues updated more recently get a boost
    const updatedDaysAgo = 1; // simplified — in real impl, parse timestamps
    const recencyBonus = Math.max(1, 5 - updatedDaysAgo);

    // Complexity penalty: prefer quick wins
    const complexityPenalty =
      issue.complexity === "S" ? 1.5 : issue.complexity === "M" ? 1.0 : 0.7;

    // Confidence bonus: prefer issues we're confident about
    const confidenceBonus =
      issue.confidence === "high" ? 1.3 : issue.confidence === "medium" ? 1.0 : 0.7;

    let score =
      severityWeight * recencyBonus * complexityPenalty * confidenceBonus;

    // Directive boost: if issue matches focus areas, boost it
    if (directives && directives.focus_areas.length > 0) {
      const issueText =
        `${issue.title} ${issue.approach} ${issue.classification}`.toLowerCase();
      for (const focus of directives.focus_areas) {
        if (issueText.includes(focus.toLowerCase())) {
          score *= 1.5;
          break;
        }
      }
    }

    // Bugs get a natural boost over features in Issue Crusher mode
    if (issue.classification === "bug") {
      score *= 1.2;
    }

    return Math.round(score * 100) / 100;
  }

  private sort(): void {
    this.items.sort((a, b) => {
      if (a.status !== b.status) {
        const order = { in_progress: 0, pending: 1, completed: 2, failed: 3, skipped: 4 };
        return order[a.status] - order[b.status];
      }
      return b.priority_score - a.priority_score;
    });
  }

  pickNext(): QueueItem | null {
    const next = this.items.find((i) => {
      if (i.status !== "pending") return false;

      // Check dependencies: all deps must be completed
      for (const depId of i.issue.dependencies) {
        const dep = this.items.find((d) => d.issue.issue_id === depId);
        if (dep && dep.status !== "completed") return false;
      }

      return true;
    });

    if (!next) return null;

    next.status = "in_progress";
    next.started_at = new Date().toISOString();
    this.sort();

    logger.info(
      "Queue",
      `Picked issue #${next.issue.issue_id} (score: ${next.priority_score})`
    );
    return next;
  }

  markCompleted(issueId: number): void {
    const item = this.items.find((i) => i.issue.issue_id === issueId);
    if (item) {
      item.status = "completed";
      item.completed_at = new Date().toISOString();
      this.sort();
      logger.success("Queue", `Issue #${issueId} marked completed`);
    }
  }

  markFailed(issueId: number, error?: string): void {
    const item = this.items.find((i) => i.issue.issue_id === issueId);
    if (item) {
      item.status = "failed";
      item.completed_at = new Date().toISOString();
      this.sort();
      logger.error("Queue", `Issue #${issueId} marked failed: ${error || "unknown"}`);
    }
  }

  reorder(directives: Directives): void {
    for (const item of this.items) {
      if (item.status === "pending") {
        item.priority_score = this.calculatePriority(item.issue, directives);
      }
    }
    this.sort();
    logger.info("Queue", "Queue reordered based on updated directives");
  }

  getStatus(): {
    total: number;
    pending: number;
    in_progress: number;
    completed: number;
    failed: number;
  } {
    return {
      total: this.items.length,
      pending: this.pending.length,
      in_progress: this.inProgress.length,
      completed: this.completed.length,
      failed: this.failed.length,
    };
  }
}
