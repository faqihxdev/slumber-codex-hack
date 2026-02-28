# 🧬 Slumber

> Point an autonomous agent swarm at any GitHub repo. It solves every issue and proposes new features. The repo never sleeps.

**Built at the OpenAI Codex Hackathon Singapore — 28 Feb 2026**

---

## What It Does

The Living Repo turns any GitHub repository into an autonomous development loop:

```
  ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
  │ OBSERVE  │────▶│  PLAN   │────▶│ EXECUTE │────▶│ SUBMIT  │
  │ (triage) │     │(priorit)│     │ (swarm) │     │  (PRs)  │
  └─────────┘     └─────────┘     └─────────┘     └────┬────┘
       ▲                                                │
       │           ┌─────────┐                          │
       └───────────│  LEARN  │◀─────────────────────────┘
                   │(feedback)│
                   └─────────┘
```

### Three Modes

| Mode | Trigger | Action |
|------|---------|--------|
| **Issue Crusher** | Open issues exist | Triages, prioritizes, resolves issues via parallel agent swarm |
| **Proactive Builder** | Backlog is clear | Proposes new features, builds approved ones |
| **Steerable Autopilot** | Human edits `DIRECTIVES.md` | Adjusts priorities, respects boundaries |

---

## Quick Start

```bash
# Clone and install
git clone <this-repo>
cd living-repo
npm install

# Configure
cp .env.example .env
# Edit .env with your GITHUB_TOKEN and OPENAI_API_KEY

# Build
npm run build

# Point at any GitHub repo — that's it
living-repo https://github.com/owner/repo
```

### CLI

```bash
# Simplest usage — auto-clones the repo, launches Ink TUI, 3 agents
living-repo https://github.com/owner/repo

# Custom concurrency
living-repo https://github.com/owner/repo -c 5

# Use an existing local clone
living-repo https://github.com/owner/repo -p /path/to/local/clone

# Plain text mode (no TUI)
living-repo https://github.com/owner/repo --no-tui

# Debug mode — writes all events to .living-repo-debug.jsonl
living-repo https://github.com/owner/repo --debug

# Legacy subcommands still work
living-repo triage --repo https://github.com/owner/repo
living-repo status --repo https://github.com/owner/repo
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-c, --concurrency <n>` | Max parallel agents | `3` |
| `-p, --path <dir>` | Local clone path | auto-clones to temp dir |
| `--no-tui` | Disable Ink TUI, use plain log output | TUI enabled |
| `--debug` | Write `.living-repo-debug.jsonl` event log | off |

---

## Cyberpunk TUI

The default interface is a live terminal dashboard built with **Ink** (React for CLI):

```
  ╔══════════════════════════════════════════════════════════════╗
  ║  ⟁  THE LIVING REPO  autonomous agent swarm                ║
  ╚══════════════════════════════════════════════════════════════╝
    target: owner/repo
  ────────────────────────────────────────────────────────────────

  ▐ TRIAGE classifying issues
   ████████████░░░░░░░░░░░░░░░░░░ 8/20 40%

  ▐ QUEUE
  ⏳ 16 pending  ⚡ 2 active  ✦ 2 done  ✘ 0 fail
   ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 2/20
  ────────────────────────────────────────────────────────────────

  ▐ AGENTS 2 active
     ⠴ ◉ 🐛 #7 Auth middleware crashes on empty Bearer  [critical] 57s
            └─ Editing: auth.ts
     ⠴ ◉ 🐛 #6 GET /tasks/:id returns 500...            [high] 57s
            └─ $ npm test
  ────────────────────────────────────────────────────────────────

  ▐ PULL REQUESTS 2 created
   ✦ PR #21 Fix: Auth middleware crashes on empty Bearer
   ✦ PR #23 Fix: GET /tasks/:id returns 500...
  ────────────────────────────────────────────────────────────────

  ⏱ 2m43s  triaged: 20  resolved: 2  PRs: 2

    press q to quit
```

Features:
- Real-time progress bars, spinners, and status indicators
- Live agent cards showing what each Codex agent is doing
- Neon cyberpunk color palette (cyan/magenta/green)
- PR feed as they're created
- Disable with `--no-tui` for plain text output

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      THE LIVING REPO                         │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │                 EVENT BUS (bus)                        │    │
│  │  init → triage → queue → agent → pr → loop            │    │
│  └──────────┬──────────────────────┬────────────────────┘    │
│             │                      │                          │
│     ┌───────▼───────┐     ┌───────▼───────┐                  │
│     │    ENGINE      │     │   INK TUI     │                  │
│     │  (engine.ts)   │     │  (ui/App.tsx) │                  │
│     └───────┬───────┘     └───────────────┘                  │
│             │                                                 │
│  ┌──────────▼──────────────────────────────────────────┐     │
│  │                   ORCHESTRATOR                       │     │
│  │  ┌────────────┐  ┌────────────┐  ┌───────────────┐ │     │
│  │  │  Ingester   │  │  Triage    │  │  Queue Mgr    │ │     │
│  │  │  (analyze)  │  │  (classify)│  │  (prioritize) │ │     │
│  │  └────────────┘  └────────────┘  └───────────────┘ │     │
│  │  ┌────────────┐  ┌────────────┐  ┌───────────────┐ │     │
│  │  │  Swarm      │  │  Feedback  │  │  Proposer     │ │     │
│  │  │  (parallel) │  │  (learn)   │  │  (features)   │ │     │
│  │  └────────────┘  └────────────┘  └───────────────┘ │     │
│  └─────────────────────────┬───────────────────────────┘     │
│              ┌──────────────┼──────────────┐                  │
│              ▼              ▼              ▼                   │
│       ┌────────────┐ ┌────────────┐ ┌────────────┐           │
│       │ Worktree 1 │ │ Worktree 2 │ │ Worktree 3 │           │
│       │ Issue #42  │ │ Issue #87  │ │ Feature X  │           │
│       │ → Fix → PR │ │ → Fix → PR │ │ → Build→PR │           │
│       └────────────┘ └────────────┘ └────────────┘           │
└──────────────────────────────────────────────────────────────┘
```

### Components

| Component | File | Purpose |
|-----------|------|---------|
| CLI | `src/index.ts` | Entry point — `living-repo <url>`, flags, subcommands |
| Event Bus | `src/events.ts` | Typed event emitter decoupling engine from UI |
| Engine | `src/engine.ts` | Event-driven pipeline: init → triage → resolve → PR |
| Ink TUI | `src/ui/App.tsx` | Cyberpunk React terminal UI |
| Orchestrator | `src/orchestrator.ts` | Legacy loop mode (still works) |
| Ingester | `src/ingester.ts` | Codebase analysis, CODEBASE_CONTEXT.md, skill gen |
| Triage | `src/triage.ts` | Issue classification via OpenAI structured output |
| Queue | `src/queue.ts` | Priority scoring with directive boosts |
| Swarm | `src/swarm.ts` | Parallel Codex agent launcher with worktree isolation |
| PR Submitter | `src/pr.ts` | Auto-creates PRs with structured descriptions |
| Feedback | `src/feedback.ts` | Learns from PR review comments |
| Proposer | `src/proposer.ts` | Generates feature proposals |
| Directives | `src/directives.ts` | Parses DIRECTIVES.md for human steering |

---

## Debuggability

Three modes for observing what's happening:

| Mode | How | When to use |
|------|-----|-------------|
| **Debug log** | `--debug` flag | Writes every event to `.living-repo-debug.jsonl` |
| **Plain text** | `--no-tui` flag | All events as log lines, readable by scripts/agents |
| **TUI** | Default | Human-facing live dashboard |

The `--debug` flag writes a newline-delimited JSON log of every event:
```json
{"type":"triage:issue","timestamp":1772260035326,"data":{"issueId":20,"classification":"chore","severity":"medium"}}
{"type":"agent:start","timestamp":1772260736842,"data":{"issueId":7,"title":"Auth middleware crashes"}}
{"type":"pr:created","timestamp":1772261488410,"data":{"issueId":7,"prNumber":21,"prUrl":"https://..."}}
```

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

The agent re-reads this file every loop iteration — edits take effect immediately.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (ESM) |
| Terminal UI | Ink (React for CLI) + @inkjs/ui |
| Agent Control | `@openai/codex-sdk` — thread management, structured output, streaming |
| Codex Model | `gpt-5.2-codex` — purpose-built for agentic coding tasks |
| Text Analysis | OpenAI API (`gpt-5.2`) — feedback extraction, proposals |
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
