import React, { useState, useEffect } from "react";
import { Box, Text, useApp, useInput } from "ink";
import {
  Spinner,
  ProgressBar,
  Badge,
  Alert,
  StatusMessage,
  ThemeProvider,
  extendTheme,
  defaultTheme,
} from "@inkjs/ui";
import { bus, type SwarmEvent } from "../events.js";

const C = {
  primary: "#a78bfa",
  accent:  "#93c5fd",
  mint:    "#86efac",
  amber:   "#fcd34d",
  rose:    "#fda4af",
  dim:     "#94a3b8",
  border:  "#475569",
  white:   "#f1f5f9",
  lilac:   "#c4b5fd",
  sky:     "#7dd3fc",
  slate:   "#64748b",
};

const theme = extendTheme(defaultTheme, {
  components: {
    Spinner: {
      styles: {
        frame: () => ({ color: C.lilac }),
        label: () => ({ color: C.white }),
      },
    },
  },
});

// ── Types ──────────────────────────────────────────────

interface AgentInfo {
  issueId: number;
  title: string;
  classification: string;
  severity: string;
  status: string;
  lastActivity: string;
  startedAt: number;
}

interface PRInfo {
  issueId: number;
  prNumber: number;
  prUrl: string;
  title: string;
  merged?: boolean;
}

interface ProposalInfo {
  title: string;
  priority: number;
  complexity: string;
  issueNumber?: number;
  issueUrl?: string;
}

interface AppState {
  phase: "init" | "triage" | "resolving" | "proposing" | "done";
  repo: string;
  agents: Map<number, AgentInfo>;
  queue: { total: number; pending: number; in_progress: number; completed: number; failed: number };
  triageProgress: { done: number; total: number };
  prs: PRInfo[];
  proposals: ProposalInfo[];
  logs: string[];
  loopCount: number;
  startedAt: number;
  metrics: { issuesTriaged: number; issuesResolved: number; prsCreated: number; prsMerged: number };
}

// ── Helpers ────────────────────────────────────────────

function elapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m${rs.toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h${rm.toString().padStart(2, "0")}m`;
}

function pct(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

const PHASE_META: Record<string, { label: string; color: string; icon: string }> = {
  init:      { label: "INITIALIZING", color: C.amber,   icon: "⏳" },
  triage:    { label: "TRIAGING",     color: C.accent,  icon: "🔍" },
  resolving: { label: "RESOLVING",    color: C.lilac,   icon: "⚡" },
  proposing: { label: "PROPOSING",    color: C.primary, icon: "💡" },
  done:      { label: "COMPLETE",     color: C.mint,    icon: "✦" },
};

const SEVERITY_BADGE: Record<string, string> = {
  critical: "red",
  high:     "yellow",
  medium:   "cyan",
  low:      "blue",
};

const CLASS_ICONS: Record<string, string> = {
  bug:      "🐛",
  feature:  "✨",
  refactor: "♻️",
  docs:     "📝",
  test:     "🧪",
  chore:    "🔧",
};

const STATUS_STYLE: Record<string, { icon: string; color: string }> = {
  starting:      { icon: "◌", color: C.dim },
  exploring:     { icon: "◎", color: C.sky },
  implementing:  { icon: "◉", color: C.accent },
  testing:       { icon: "◈", color: C.amber },
  committing:    { icon: "◆", color: C.mint },
  pushing:       { icon: "▲", color: C.lilac },
  done:          { icon: "✦", color: C.mint },
  failed:        { icon: "✘", color: C.rose },
};

// ── Header ─────────────────────────────────────────────

function Header({ repo, phase, startedAt }: { repo: string; phase: string; startedAt: number }) {
  const pm = PHASE_META[phase] || PHASE_META.init;
  return (
    <Box borderStyle="double" borderColor={C.primary} flexDirection="column" paddingX={2}>
      <Box justifyContent="space-between">
        <Text color={C.lilac} bold> ⟁  THE LIVING REPO</Text>
        <Text color={C.slate} italic>autonomous agent swarm</Text>
      </Box>
      <Box gap={2}>
        <Text color={C.white} bold>{repo}</Text>
        <Text color={C.slate}>│</Text>
        <Text color={pm.color} bold>{pm.icon} {pm.label}</Text>
        <Text color={C.slate}>│</Text>
        <Text color={C.dim}>uptime <Text color={C.white} bold>{elapsed(Date.now() - startedAt)}</Text></Text>
      </Box>
    </Box>
  );
}

// ── Init Phase ─────────────────────────────────────────

function InitPanel() {
  return (
    <Box borderStyle="round" borderColor={C.amber} paddingX={1}>
      <Spinner label="Initializing — scanning repository structure..." />
    </Box>
  );
}

// ── Triage Panel ───────────────────────────────────────

function TriagePanel({ progress }: { progress: { done: number; total: number } }) {
  const p = pct(progress.done, progress.total);
  return (
    <Box borderStyle="bold" borderColor={C.accent} flexDirection="column" paddingX={1}>
      <Box gap={1}>
        <Text color={C.accent} bold>TRIAGE</Text>
        <Text color={C.dim}>— classifying open issues</Text>
      </Box>
      <Box gap={1} alignItems="center">
        <Box flexGrow={1}>
          <ProgressBar value={p} />
        </Box>
        <Text color={C.white} bold> {p}%</Text>
        <Text color={C.dim}>({progress.done}/{progress.total})</Text>
      </Box>
    </Box>
  );
}

// ── Done Alert ─────────────────────────────────────────

function DoneAlert({ metrics }: { metrics: AppState["metrics"] }) {
  return (
    <Alert variant="success">
      Cycle complete — {metrics.issuesResolved} resolved, {metrics.prsCreated} PRs, {metrics.prsMerged} merged
    </Alert>
  );
}

// ── Queue Panel ────────────────────────────────────────

function QueuePanel({ queue }: { queue: AppState["queue"] }) {
  const p = pct(queue.completed + queue.failed, queue.total);
  return (
    <Box borderStyle="round" borderColor={C.accent} flexDirection="column" paddingX={1} flexGrow={1}>
      <Text color={C.accent} bold>QUEUE</Text>
      <Box flexDirection="column">
        <Box gap={2}>
          <Text><Text color={C.amber}>⏳ {queue.pending}</Text> <Text color={C.dim}>pending</Text></Text>
          <Text><Text color={C.lilac}>⚡ {queue.in_progress}</Text> <Text color={C.dim}>active</Text></Text>
        </Box>
        <Box gap={2}>
          <Text><Text color={C.mint}>✦ {queue.completed}</Text> <Text color={C.dim}>done</Text></Text>
          <Text><Text color={C.rose}>✘ {queue.failed}</Text> <Text color={C.dim}>fail</Text></Text>
        </Box>
      </Box>
      {queue.total > 0 && (
        <Box gap={1} alignItems="center">
          <Box flexGrow={1}>
            <ProgressBar value={p} />
          </Box>
          <Text color={C.dim}>{queue.completed + queue.failed}/{queue.total}</Text>
        </Box>
      )}
    </Box>
  );
}

// ── Metrics Panel ──────────────────────────────────────

function MetricsPanel({ metrics, startedAt }: { metrics: AppState["metrics"]; startedAt: number }) {
  const rate = metrics.issuesTriaged > 0
    ? Math.round((metrics.issuesResolved / metrics.issuesTriaged) * 100)
    : 0;
  return (
    <Box borderStyle="round" borderColor={C.primary} flexDirection="column" paddingX={1} flexGrow={1}>
      <Text color={C.primary} bold>METRICS</Text>
      <Text><Text color={C.dim}>⏱</Text>  <Text color={C.white} bold>{elapsed(Date.now() - startedAt)}</Text> <Text color={C.dim}>elapsed</Text></Text>
      <Text><Text color={C.accent}>📊</Text> <Text color={C.white} bold>{metrics.issuesTriaged}</Text> <Text color={C.dim}>triaged</Text></Text>
      <Text><Text color={C.mint}>✦</Text>  <Text color={C.white} bold>{metrics.issuesResolved}</Text> <Text color={C.dim}>resolved</Text></Text>
      <Text><Text color={C.lilac}>📬</Text> <Text color={C.white} bold>{metrics.prsCreated}</Text> <Text color={C.dim}>PRs created</Text></Text>
      <Text><Text color={C.sky}>🔀</Text> <Text color={C.white} bold>{metrics.prsMerged}</Text> <Text color={C.dim}>merged</Text></Text>
      {metrics.issuesTriaged > 0 && (
        <Text><Text color={rate >= 75 ? C.mint : rate >= 50 ? C.amber : C.rose}>✧</Text>  <Text color={C.white} bold>{rate}%</Text> <Text color={C.dim}>success rate</Text></Text>
      )}
    </Box>
  );
}

// ── Agent Card ─────────────────────────────────────────

function cleanActivity(raw: string): string {
  if (!raw) return "";
  let s = raw;
  if (s.startsWith("$ ")) {
    s = s.slice(2);
    s = s.replace(/^"[^"]*[/\\](pwsh|powershell|bash|sh|cmd|node)\.exe"\s+(-\w+\s+)?/i, "");
    s = s.replace(/^'|'$/g, "");
    const base = s.split(/[/\\]/).pop() || s;
    return `running ${base}`;
  }
  return s;
}

function AgentCard({ agent }: { agent: AgentInfo }) {
  const icon = CLASS_ICONS[agent.classification] || "📦";
  const style = STATUS_STYLE[agent.status] || { icon: "?", color: C.dim };
  const isActive = !["done", "failed"].includes(agent.status);
  const badgeColor = SEVERITY_BADGE[agent.severity] || "blue";
  const borderClr = agent.status === "failed" ? C.rose : agent.status === "done" ? C.mint : C.border;
  const activity = cleanActivity(agent.lastActivity);

  return (
    <Box borderStyle="single" borderColor={borderClr} flexDirection="column" paddingX={1}>
      <Box gap={1} alignItems="center">
        {isActive && <Spinner label="" />}
        <Text color={style.color}>{style.icon}</Text>
        <Text>{icon}</Text>
        <Text color={C.white} bold>#{agent.issueId}</Text>
        <Text color={C.white} wrap="truncate">{agent.title}</Text>
        <Badge color={badgeColor}>{agent.severity}</Badge>
        <Text color={C.dim}>{elapsed(Date.now() - agent.startedAt)}</Text>
      </Box>
      {activity && (
        <Text color={C.dim} wrap="truncate"> └─ {activity}</Text>
      )}
    </Box>
  );
}

// ── Agents Panel ───────────────────────────────────────

function AgentsPanel({ agents }: { agents: Map<number, AgentInfo> }) {
  const entries = [...agents.values()];
  const activeCount = entries.filter((a) => !["done", "failed"].includes(a.status)).length;
  return (
    <Box borderStyle="round" borderColor={C.lilac} flexDirection="column" paddingX={1}>
      <Box gap={1}>
        <Text color={C.lilac} bold>AGENTS</Text>
        {activeCount > 0 ? (
          <Badge color="cyan">{`${activeCount} active`}</Badge>
        ) : (
          <Text color={C.dim}>idle</Text>
        )}
      </Box>
      {entries.length === 0 ? (
        <Text color={C.dim}>no agents running</Text>
      ) : (
        <Box flexDirection="column" gap={0}>
          {entries.map((a) => <AgentCard key={a.issueId} agent={a} />)}
        </Box>
      )}
    </Box>
  );
}

// ── PR Panel ───────────────────────────────────────────

function PRPanel({ prs }: { prs: PRInfo[] }) {
  const recent = prs.slice(-6);
  const mergedCount = prs.filter(p => p.merged).length;
  return (
    <Box borderStyle="round" borderColor={C.mint} flexDirection="column" paddingX={1} flexGrow={1}>
      <Box gap={1}>
        <Text color={C.mint} bold>PULL REQUESTS</Text>
        {prs.length > 0 && <Badge color="green">{String(prs.length)}</Badge>}
        {mergedCount > 0 && <Text color={C.sky}>({mergedCount} merged)</Text>}
      </Box>
      {recent.length === 0 ? (
        <Text color={C.dim}>none yet</Text>
      ) : (
        recent.map((pr) => (
          <Box key={pr.prNumber} gap={1}>
            <Text color={pr.merged ? C.sky : C.mint}>{pr.merged ? "🔀" : "✦"}</Text>
            <Text color={C.white} bold>#{pr.prNumber}</Text>
            <Text color={C.dim} wrap="truncate">{pr.title}</Text>
            {pr.merged && <Text color={C.sky}>merged</Text>}
          </Box>
        ))
      )}
    </Box>
  );
}

function ProposalsPanel({ proposals }: { proposals: ProposalInfo[] }) {
  if (proposals.length === 0) return null;
  return (
    <Box borderStyle="round" borderColor={C.primary} flexDirection="column" paddingX={1} flexGrow={1}>
      <Box gap={1}>
        <Text color={C.primary} bold>NEW FEATURE SUGGESTED</Text>
      </Box>
      {proposals.map((p, i) => (
        <Box key={`proposal-${i}-${p.title.slice(0, 10)}`} flexDirection="column">
          <Box gap={1}>
            <Text color={C.amber}>💡</Text>
            {p.issueNumber && <Text color={C.white} bold>#{p.issueNumber}</Text>}
            <Text color={C.white} wrap="truncate">{p.title}</Text>
          </Box>
          <Text color={C.dim}> └─ priority {p.priority}/10 • complexity {p.complexity} • posted as GitHub issue</Text>
        </Box>
      ))}
    </Box>
  );
}

// ── Activity Log ───────────────────────────────────────

function logColor(msg: string): string {
  if (msg.includes("⚡")) return C.lilac;
  if (msg.includes("✦")) return C.mint;
  if (msg.includes("✘") || msg.includes("⚠")) return C.rose;
  if (msg.includes("📬") || msg.includes("🔀")) return C.sky;
  if (msg.includes("💡")) return C.primary;
  if (msg.includes("⟁")) return C.accent;
  if (msg.includes("classified")) return C.dim;
  return C.slate;
}

function LogPanel({ logs }: { logs: string[] }) {
  const recent = logs.slice(-8);
  return (
    <Box borderStyle="round" borderColor={C.border} flexDirection="column" paddingX={1} flexGrow={1}>
      <Text color={C.dim} bold>ACTIVITY LOG</Text>
      {recent.map((log, i) => (
        <Text key={`log-${i}-${log.slice(0, 20)}`} color={logColor(log)} wrap="truncate">
          {log}
        </Text>
      ))}
    </Box>
  );
}

// ── Footer ─────────────────────────────────────────────

function Footer() {
  return (
    <Box justifyContent="center" gap={1}>
      <Text color={C.dim}>press</Text>
      <Text color={C.lilac} bold>q</Text>
      <Text color={C.dim}>to quit</Text>
      <Text color={C.border}>│</Text>
      <Text color={C.lilac} bold>ctrl+c</Text>
      <Text color={C.dim}>to exit</Text>
    </Box>
  );
}

// ── Main App ───────────────────────────────────────────

export default function App({ repo }: { repo: string }) {
  const { exit } = useApp();
  const [state, setState] = useState<AppState>({
    phase: "init",
    repo,
    agents: new Map(),
    queue: { total: 0, pending: 0, in_progress: 0, completed: 0, failed: 0 },
    triageProgress: { done: 0, total: 0 },
    prs: [],
    proposals: [],
    logs: ["⟁ Booting up the living repo..."],
    loopCount: 0,
    startedAt: Date.now(),
    metrics: { issuesTriaged: 0, issuesResolved: 0, prsCreated: 0, prsMerged: 0 },
  });

  const [tick, setTick] = useState(0);
  void tick;

  useInput((input, key) => {
    if (input === "q" || (input === "c" && key.ctrl)) {
      exit();
      process.exit(0);
    }
  }, { isActive: process.stdin.isTTY === true });

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const addLog = (msg: string) => {
      setState((s) => ({ ...s, logs: [...s.logs.slice(-30), msg] }));
    };

    bus.on("init:start", () => {
      setState((s) => ({ ...s, phase: "init" }));
      addLog("⟁ Initializing the living repo...");
    });

    bus.on("init:done", () => {
      addLog("⟁ Initialization complete");
    });

    bus.on("triage:start", (e: SwarmEvent) => {
      setState((s) => ({
        ...s,
        phase: "triage",
        triageProgress: { done: 0, total: (e.total as number) || 0 },
      }));
      addLog(`⟁ Triaging ${e.total} issues...`);
    });

    bus.on("triage:progress", (e: SwarmEvent) => {
      setState((s) => ({
        ...s,
        triageProgress: {
          done: (e.done as number) || s.triageProgress.done,
          total: (e.total as number) || s.triageProgress.total,
        },
      }));
    });

    bus.on("triage:issue", (e: SwarmEvent) => {
      addLog(`  classified #${e.issueId}: ${e.classification}/${e.severity}`);
    });

    bus.on("triage:done", (e: SwarmEvent) => {
      setState((s) => ({
        ...s,
        metrics: { ...s.metrics, issuesTriaged: (e.count as number) || 0 },
      }));
      addLog(`⟁ Triage complete: ${e.count} issues classified`);
    });

    bus.on("queue:update", (e: SwarmEvent) => {
      const q = e.queue as AppState["queue"];
      if (q) setState((s) => ({ ...s, queue: q }));
    });

    bus.on("agent:start", (e: SwarmEvent) => {
      setState((s) => {
        const agents = new Map(s.agents);
        agents.set(e.issueId as number, {
          issueId: e.issueId as number,
          title: (e.title as string) || "",
          classification: (e.classification as string) || "",
          severity: (e.severity as string) || "",
          status: "starting",
          lastActivity: "Initializing...",
          startedAt: Date.now(),
        });
        return { ...s, agents };
      });
      addLog(`⚡ Agent started for #${e.issueId}`);
    });

    bus.on("agent:activity", (e: SwarmEvent) => {
      setState((s) => {
        const agents = new Map(s.agents);
        const agent = agents.get(e.issueId as number);
        if (agent) {
          agents.set(e.issueId as number, {
            ...agent,
            status: (e.status as string) || agent.status,
            lastActivity: (e.activity as string) || agent.lastActivity,
          });
        }
        return { ...s, agents };
      });
    });

    bus.on("agent:done", (e: SwarmEvent) => {
      setState((s) => {
        const agents = new Map(s.agents);
        const agent = agents.get(e.issueId as number);
        if (agent) {
          agents.set(e.issueId as number, {
            ...agent,
            status: "done",
            lastActivity: `${e.filesChanged} files changed`,
          });
        }
        return { ...s, metrics: { ...s.metrics, issuesResolved: s.metrics.issuesResolved + 1 } };
      });
      addLog(`✦ Agent done for #${e.issueId}: ${e.filesChanged} files changed`);
      setTimeout(() => {
        setState((s) => {
          const agents = new Map(s.agents);
          agents.delete(e.issueId as number);
          return { ...s, agents };
        });
      }, 5000);
    });

    bus.on("agent:failed", (e: SwarmEvent) => {
      setState((s) => {
        const agents = new Map(s.agents);
        const agent = agents.get(e.issueId as number);
        if (agent) {
          agents.set(e.issueId as number, {
            ...agent,
            status: "failed",
            lastActivity: (e.error as string) || "unknown error",
          });
        }
        return { ...s };
      });
      addLog(`✘ Agent failed for #${e.issueId}: ${(e.error as string)?.slice(0, 50)}`);
      setTimeout(() => {
        setState((s) => {
          const agents = new Map(s.agents);
          agents.delete(e.issueId as number);
          return { ...s, agents };
        });
      }, 5000);
    });

    bus.on("pr:created", (e: SwarmEvent) => {
      setState((s) => ({
        ...s,
        prs: [...s.prs, {
          issueId: e.issueId as number,
          prNumber: e.prNumber as number,
          prUrl: (e.prUrl as string) || "",
          title: (e.title as string) || "",
          merged: false,
        }],
        metrics: { ...s.metrics, prsCreated: s.metrics.prsCreated + 1 },
      }));
      addLog(`📬 PR #${e.prNumber} created for #${e.issueId}`);
    });

    bus.on("pr:merged", (e: SwarmEvent) => {
      setState((s) => ({
        ...s,
        prs: s.prs.map((pr) =>
          pr.prNumber === (e.prNumber as number) ? { ...pr, merged: true } : pr
        ),
        metrics: { ...s.metrics, prsMerged: s.metrics.prsMerged + 1 },
      }));
      addLog(`🔀 PR #${e.prNumber} auto-merged for #${e.issueId}`);
    });

    bus.on("pr:merge_failed", (e: SwarmEvent) => {
      addLog(`⚠ PR #${e.prNumber} merge failed: ${(e.reason as string)?.slice(0, 40)}`);
    });

    bus.on("propose:start", () => {
      setState((s) => ({ ...s, phase: "proposing" }));
      addLog("💡 Generating feature suggestion...");
    });

    bus.on("propose:issue_created", (e: SwarmEvent) => {
      setState((s) => ({
        ...s,
        proposals: [...s.proposals, {
          title: (e.title as string) || "",
          priority: (e.priority as number) || 0,
          complexity: (e.complexity as string) || "M",
          issueNumber: e.issueNumber as number,
          issueUrl: (e.issueUrl as string) || "",
        }],
      }));
      addLog(`💡 Created issue #${e.issueNumber}: ${(e.title as string)?.slice(0, 40)}`);
    });

    bus.on("propose:done", () => {
      setState((s) => ({ ...s, phase: "resolving" }));
      addLog(`💡 Feature suggestion posted — starting agent swarm`);
    });

    bus.on("loop:done", () => {
      setState((s) => ({ ...s, phase: "done" }));
      addLog("⟁ All issues processed — cycle complete");
    });

    bus.on("error", (e: SwarmEvent) => {
      addLog(`⚠ ${(e.message as string)?.slice(0, 60)}`);
    });

    return () => { bus.removeAllListeners(); };
  }, []);

  const showTriage = state.phase === "triage" || (
    state.triageProgress.total > 0 && state.triageProgress.done < state.triageProgress.total
  );

  return (
    <ThemeProvider theme={theme}>
      <Box flexDirection="column">
        <Header repo={state.repo} phase={state.phase} startedAt={state.startedAt} />
        {state.phase === "init" && <InitPanel />}
        {showTriage && <TriagePanel progress={state.triageProgress} />}
        <ProposalsPanel proposals={state.proposals} />
        {state.phase === "done" && <DoneAlert metrics={state.metrics} />}
        <Box>
          <QueuePanel queue={state.queue} />
          <MetricsPanel metrics={state.metrics} startedAt={state.startedAt} />
        </Box>
        <AgentsPanel agents={state.agents} />
        <Box>
          <PRPanel prs={state.prs} />
          <LogPanel logs={state.logs} />
        </Box>
        <Footer />
      </Box>
    </ThemeProvider>
  );
}
