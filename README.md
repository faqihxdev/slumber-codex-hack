# Slumber

> Point an autonomous agent swarm at any GitHub repo. It solves every issue, proposes new features, and auto-merges the fixes. The repo never sleeps.

**Built at the OpenAI Codex Hackathon Singapore — 28 Feb 2026**

---

## What It Does

Slumber turns any GitHub repository into an autonomous development loop:

```
  ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
  │ OBSERVE  │────▶│  PLAN   │────▶│ SUGGEST │────▶│ EXECUTE │────▶│ MERGE   │
  │ (triage) │     │(priorit)│     │(propose)│     │ (swarm) │     │(auto-PR)│
  └─────────┘     └─────────┘     └─────────┘     └─────────┘     └─────────┘
```

### Pipeline

| Step | What Happens |
|------|-------------|
| **Triage** | Classifies every open issue by type, severity, and complexity using OpenAI structured output |
| **Suggest** | Proposes one new feature and files it as a GitHub issue |
| **Resolve** | Launches parallel Codex agents in isolated git worktrees to fix issues |
| **PR + Merge** | Creates a PR for each fix, then auto-squash-merges it |

### Human Steering

Drop a `DIRECTIVES.md` in the target repo to control priorities, set off-limits areas, and enforce coding conventions. The agent re-reads it every loop.

---

## Quick Start

```bash
# Clone and install
git clone <this-repo>
cd slumber
npm install

# Configure
cp .env.example .env
# Edit .env with your GITHUB_TOKEN and OPENAI_API_KEY

# Build
npm run build

# Point at any GitHub repo — that's it
node dist/index.js https://github.com/owner/repo
```

### Run Script

```bash
# Interactive — prompts for repo URL and concurrency
bash run.sh
```

### CLI Options

```bash
# Simplest usage — auto-clones the repo, launches TUI, 3 agents
node dist/index.js https://github.com/owner/repo

# Custom concurrency
node dist/index.js https://github.com/owner/repo -c 5

# Use an existing local clone
node dist/index.js https://github.com/owner/repo -p /path/to/local/clone

# Plain text mode (no TUI)
node dist/index.js https://github.com/owner/repo --no-tui

# Debug mode — writes all events to .living-repo-debug.jsonl
node dist/index.js https://github.com/owner/repo --debug
```

| Flag | Description | Default |
|------|-------------|---------|
| `-c, --concurrency <n>` | Max parallel agents | `3` |
| `-p, --path <dir>` | Local clone path | auto-clones to temp dir |
| `--no-tui` | Disable Ink TUI, use plain log output | TUI enabled |
| `--debug` | Write `.living-repo-debug.jsonl` event log | off |

---

## Terminal UI

The default interface is a live terminal dashboard built with **Ink** (React for CLI):

```
╔══════════════════════════════════════════════════════════════╗
║  ⟁  SLUMBER  autonomous agent swarm                         ║
║  owner/repo  │  ⚡ RESOLVING  │  uptime 2m43s               ║
╚══════════════════════════════════════════════════════════════╝
╭──────────────────────────────╮╭──────────────────────────────╮
│ QUEUE                        ││ METRICS                      │
│ ⏳ 14 pending  ⚡ 3 active   ││ 📊 20 triaged               │
│ ✦ 3 done  ✘ 0 fail          ││ ✦  3 resolved               │
│ ████░░░░░░░░░░ 3/20          ││ 📬 3 PRs created            │
╰──────────────────────────────╯│ 🔀 3 merged                 │
                                ╰──────────────────────────────╯
╭──────────────────────────────────────────────────────────────╮
│ AGENTS 3 active                                              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ ⠴ ◉ 🐛 #7 Auth middleware crashes on empty Bearer  57s  │ │
│ │  └─ Editing: auth.ts                                     │ │
│ └──────────────────────────────────────────────────────────┘ │
╰──────────────────────────────────────────────────────────────╯
╭──────────────────────────────╮╭──────────────────────────────╮
│ PULL REQUESTS 3              ││ ACTIVITY LOG                 │
│ 🔀 #37 Fix: Auth crashes     ││ ⚡ Agent started for #7     │
│ 🔀 #38 Fix: 500 on tasks    ││ 📬 PR #37 created           │
│ ✦ #39 Fix: Input validation  ││ 🔀 PR #37 auto-merged      │
╰──────────────────────────────╯╰──────────────────────────────╯
╭──────────────────────────────────────────────────────────────╮
│ NEW FEATURE SUGGESTED                                        │
│ 💡 #21 Add rate limiting middleware                          │
│  └─ priority 8/10 • complexity M • posted as GitHub issue    │
╰──────────────────────────────────────────────────────────────╯
                          press q to quit │ ctrl+c to exit
```

Features:
- Real-time progress bars, spinners, and status indicators
- Live agent cards showing what each Codex agent is doing
- Clean pastel color palette (lavender, sky blue, mint)
- PR feed with merge status
- Feature suggestion panel
- Disable with `--no-tui` for plain text output

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                         SLUMBER                               │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │                 EVENT BUS (bus)                        │    │
│  │  init → triage → propose → queue → agent → pr → done  │    │
│  └──────────┬──────────────────────┬────────────────────┘    │
│             │                      │                          │
│     ┌───────▼───────┐     ┌───────▼───────┐                  │
│     │    ENGINE      │     │   INK TUI     │                  │
│     │  (engine.ts)   │     │  (ui/App.tsx) │                  │
│     └───────┬───────┘     └───────────────┘                  │
│             │                                                 │
│  ┌──────────▼──────────────────────────────────────────┐     │
│  │                  PIPELINE                            │     │
│  │  ┌────────────┐  ┌────────────┐  ┌───────────────┐ │     │
│  │  │  Ingester   │  │  Triage    │  │  Proposer     │ │     │
│  │  │  (analyze)  │  │  (classify)│  │  (suggest)    │ │     │
│  │  └────────────┘  └────────────┘  └───────────────┘ │     │
│  │  ┌────────────┐  ┌────────────┐  ┌───────────────┐ │     │
│  │  │  Queue      │  │  Swarm     │  │  PR + Merge   │ │     │
│  │  │ (prioritize)│  │  (parallel)│  │  (auto-merge) │ │     │
│  │  └────────────┘  └────────────┘  └───────────────┘ │     │
│  └─────────────────────────┬───────────────────────────┘     │
│              ┌──────────────┼──────────────┐                  │
│              ▼              ▼              ▼                   │
│       ┌────────────┐ ┌────────────┐ ┌────────────┐           │
│       │ Worktree 1 │ │ Worktree 2 │ │ Worktree 3 │           │
│       │ Issue #42  │ │ Issue #87  │ │ Issue #15  │           │
│       │ → Fix → PR │ │ → Fix → PR │ │ → Fix → PR │           │
│       │ → Merge ✓  │ │ → Merge ✓  │ │ → Merge ✓  │           │
│       └────────────┘ └────────────┘ └────────────┘           │
└──────────────────────────────────────────────────────────────┘
```

### Components

| Component | File | Purpose |
|-----------|------|---------|
| CLI | `src/index.ts` | Entry point with flags and subcommands |
| Event Bus | `src/events.ts` | Typed event emitter decoupling engine from UI |
| Engine | `src/engine.ts` | Event-driven pipeline: init → triage → propose → resolve → merge |
| Ink TUI | `src/ui/App.tsx` | React terminal dashboard |
| Ingester | `src/ingester.ts` | Codebase analysis via OpenAI API |
| Triage | `src/triage.ts` | Issue classification via OpenAI structured output |
| Queue | `src/queue.ts` | Priority scoring with directive boosts |
| Swarm | `src/swarm.ts` | Parallel Codex agent launcher with worktree isolation |
| PR + Merge | `src/pr.ts` | Auto-creates PRs and squash-merges them |
| Proposer | `src/proposer.ts` | Generates feature proposals, files as GitHub issues |
| Feedback | `src/feedback.ts` | Learns from PR review comments |
| Directives | `src/directives.ts` | Parses DIRECTIVES.md for human steering |

---

## Human Steering via DIRECTIVES.md

Drop a `DIRECTIVES.md` in the target repo root to control the agent:

```markdown
## Current Focus
- Fix bugs before adding features
- Prioritize authentication issues

## Off Limits
- /src/legacy/**
- /migrations/**

## Style Preferences
- Use async/await, never .then() chains
- All functions must have JSDoc comments

## Constraints
- All PRs must include at least one new test
- Maximum 200 lines changed per PR
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (ESM) |
| Terminal UI | Ink (React for CLI) + @inkjs/ui |
| Agent Control | `@openai/codex-sdk` — thread management, structured output, streaming |
| Codex Model | `gpt-5.2-codex` — purpose-built for agentic coding tasks |
| Text Analysis | OpenAI API (`gpt-5.2`) — triage, proposals, codebase analysis |
| GitHub | `@octokit/rest` (REST API) |
| Validation | Zod |
| CLI | Commander |
| Isolation | Git worktrees |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | Yes | GitHub personal access token with repo access |
| `OPENAI_API_KEY` | Yes | OpenAI API key |
| `CODEX_MODEL` | No | Codex model for agent work (default: `gpt-5.2-codex`) |
| `API_MODEL` | No | OpenAI model for text analysis (default: `gpt-5.2`) |
| `MAX_CONCURRENCY` | No | Max parallel agents (default: 3) |
| `AGENT_TIMEOUT` | No | Agent timeout in ms (default: 600000) |

---

## License

MIT
