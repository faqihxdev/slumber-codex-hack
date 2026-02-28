import chalk from "chalk";
import type { PRResult, TriagedIssue } from "./types.js";

export interface AgentStatus {
  issueId: number;
  title: string;
  classification: string;
  severity: string;
  status: "starting" | "exploring" | "implementing" | "testing" | "reviewing" | "committing" | "pushing" | "done" | "failed";
  startedAt: number;
  lastActivity: string;
}

export interface DashboardState {
  mode: string;
  agents: Map<number, AgentStatus>;
  queue: { total: number; pending: number; in_progress: number; completed: number; failed: number };
  prs: PRResult[];
  triageProgress: { done: number; total: number };
  metrics: { issuesTriaged: number; issuesResolved: number; prsCreated: number; skillsLearned: number };
  startedAt: number;
  loopCount: number;
}

export function createDashboardState(): DashboardState {
  return {
    mode: "initializing",
    agents: new Map(),
    queue: { total: 0, pending: 0, in_progress: 0, completed: 0, failed: 0 },
    prs: [],
    triageProgress: { done: 0, total: 0 },
    metrics: { issuesTriaged: 0, issuesResolved: 0, prsCreated: 0, skillsLearned: 0 },
    startedAt: Date.now(),
    loopCount: 0,
  };
}

const SEVERITY_COLORS: Record<string, (s: string) => string> = {
  critical: chalk.bgRed.white.bold,
  high: chalk.red.bold,
  medium: chalk.yellow,
  low: chalk.gray,
};

const STATUS_ICONS: Record<string, string> = {
  starting: "⏳",
  exploring: "🔍",
  implementing: "🔨",
  testing: "🧪",
  reviewing: "📋",
  committing: "💾",
  pushing: "🚀",
  done: "✅",
  failed: "❌",
};

const CLASS_ICONS: Record<string, string> = {
  bug: "🐛",
  feature: "✨",
  refactor: "♻️",
  docs: "📝",
  test: "🧪",
  chore: "🔧",
};

function elapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m${rs.toString().padStart(2, "0")}s`;
}

function progressBar(current: number, total: number, width: number = 20): string {
  if (total === 0) return chalk.gray("░".repeat(width));
  const pct = Math.min(current / total, 1);
  const filled = Math.round(pct * width);
  const empty = width - filled;
  return chalk.green("█".repeat(filled)) + chalk.gray("░".repeat(empty)) + chalk.white(` ${current}/${total}`);
}

export function render(state: DashboardState): void {
  const lines: string[] = [];
  const now = Date.now();
  const w = Math.min(process.stdout.columns || 80, 100);
  const divider = chalk.magenta("─".repeat(w));

  lines.push("");
  lines.push(chalk.bold.magenta("  ╔═══════════════════════════════════════════════════════╗"));
  lines.push(chalk.bold.magenta("  ║") + chalk.bold.white("  🧬 THE LIVING REPO ") + chalk.gray("— Live Dashboard") + chalk.bold.magenta("              ║"));
  lines.push(chalk.bold.magenta("  ╚═══════════════════════════════════════════════════════╝"));
  lines.push("");

  // Status bar
  const uptime = elapsed(now - state.startedAt);
  lines.push(
    chalk.white("  Mode: ") + chalk.cyan.bold(state.mode.toUpperCase()) +
    chalk.gray("  │  ") +
    chalk.white("Loop: ") + chalk.cyan.bold(String(state.loopCount)) +
    chalk.gray("  │  ") +
    chalk.white("Uptime: ") + chalk.cyan(uptime)
  );
  lines.push(divider);

  // Queue status
  lines.push(chalk.bold.white("  📊 QUEUE"));
  const q = state.queue;
  lines.push(
    "  " +
    chalk.yellow(`⏳ ${q.pending} pending`) + "  " +
    chalk.cyan(`⚙️  ${q.in_progress} active`) + "  " +
    chalk.green(`✅ ${q.completed} done`) + "  " +
    chalk.red(`❌ ${q.failed} failed`) + "  " +
    chalk.gray(`(${q.total} total)`)
  );
  if (q.total > 0) {
    lines.push("  " + progressBar(q.completed + q.failed, q.total, 30));
  }
  lines.push(divider);

  // Triage progress (if active)
  if (state.triageProgress.total > 0 && state.triageProgress.done < state.triageProgress.total) {
    lines.push(chalk.bold.white("  🔍 TRIAGE"));
    lines.push("  " + progressBar(state.triageProgress.done, state.triageProgress.total, 30));
    lines.push(divider);
  }

  // Active agents
  lines.push(chalk.bold.white("  🤖 ACTIVE AGENTS"));
  if (state.agents.size === 0) {
    lines.push(chalk.gray("  No agents running"));
  } else {
    for (const [, agent] of state.agents) {
      const icon = STATUS_ICONS[agent.status] || "?";
      const classIcon = CLASS_ICONS[agent.classification] || "📦";
      const severityColor = SEVERITY_COLORS[agent.severity] || chalk.white;
      const agentElapsed = elapsed(now - agent.startedAt);

      lines.push(
        `  ${icon} ${classIcon} ` +
        chalk.bold.white(`#${agent.issueId}`) + " " +
        chalk.white(agent.title.slice(0, 40)) + " " +
        severityColor(`[${agent.severity}]`) + " " +
        chalk.gray(agentElapsed)
      );
      if (agent.lastActivity) {
        lines.push(chalk.gray(`     └─ ${agent.lastActivity.slice(0, 60)}`));
      }
    }
  }
  lines.push(divider);

  // Recent PRs
  lines.push(chalk.bold.white("  📬 PULL REQUESTS"));
  if (state.prs.length === 0) {
    lines.push(chalk.gray("  No PRs submitted yet"));
  } else {
    for (const pr of state.prs.slice(-5)) {
      lines.push(
        "  " + chalk.green("✓") + " " +
        chalk.bold.white(`PR #${pr.pr_number}`) + " " +
        chalk.white(pr.title.slice(0, 50)) +
        chalk.gray(` → ${pr.pr_url}`)
      );
    }
  }
  lines.push(divider);

  // Metrics scoreboard
  lines.push(chalk.bold.white("  📈 METRICS"));
  lines.push(
    "  " +
    chalk.white("Triaged: ") + chalk.cyan.bold(String(state.metrics.issuesTriaged)) + "  " +
    chalk.white("Resolved: ") + chalk.green.bold(String(state.metrics.issuesResolved)) + "  " +
    chalk.white("PRs: ") + chalk.magenta.bold(String(state.metrics.prsCreated)) + "  " +
    chalk.white("Skills: ") + chalk.yellow.bold(String(state.metrics.skillsLearned))
  );
  lines.push("");

  // Clear screen and render
  process.stdout.write("\x1B[2J\x1B[H");
  process.stdout.write(lines.join("\n") + "\n");
}

export function addAgent(state: DashboardState, issue: TriagedIssue): void {
  state.agents.set(issue.issue_id, {
    issueId: issue.issue_id,
    title: issue.title,
    classification: issue.classification,
    severity: issue.severity,
    status: "starting",
    startedAt: Date.now(),
    lastActivity: "Initializing...",
  });
}

export function updateAgentStatus(
  state: DashboardState,
  issueId: number,
  status: AgentStatus["status"],
  activity?: string
): void {
  const agent = state.agents.get(issueId);
  if (agent) {
    agent.status = status;
    if (activity) agent.lastActivity = activity;
  }
}

export function removeAgent(state: DashboardState, issueId: number): void {
  state.agents.delete(issueId);
}
