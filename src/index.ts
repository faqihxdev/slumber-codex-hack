#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import { promisify } from "util";
import { render } from "ink";
import React from "react";
import { bus } from "./events.js";

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

import type { LivingRepoConfig } from "./types.js";

function setupCleanExit(): void {
  const cleanup = () => {
    bus.close();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("SIGHUP", cleanup);
}

const BANNER = `
${chalk.bold.hex("#a78bfa")("  ╔══════════════════════════════════════════════════════════════╗")}
${chalk.bold.hex("#a78bfa")("  ║")}  ${chalk.bold.hex("#c4b5fd")("⟁  THE LIVING REPO")}  ${chalk.hex("#94a3b8")("— autonomous agent swarm")}${chalk.bold.hex("#a78bfa")("              ║")}
${chalk.bold.hex("#a78bfa")("  ╚══════════════════════════════════════════════════════════════╝")}
`;

function loadConfig(repoUrl: string, repoPath: string, concurrency: number): LivingRepoConfig {
  const githubToken = process.env.GITHUB_TOKEN;
  const openaiApiKey = process.env.OPENAI_API_KEY;

  if (!githubToken) {
    console.error(chalk.red("Error: GITHUB_TOKEN not set. Add it to .env or set in environment."));
    process.exit(1);
  }
  if (!openaiApiKey) {
    console.error(chalk.red("Error: OPENAI_API_KEY not set. Add it to .env or set in environment."));
    process.exit(1);
  }

  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (!match) {
    console.error(chalk.red(`Invalid GitHub URL: ${repoUrl}`));
    process.exit(1);
  }

  return {
    repoOwner: match[1],
    repoName: match[2],
    repoPath: path.resolve(repoPath),
    githubToken,
    openaiApiKey,
    maxConcurrency: concurrency,
    agentTimeout: parseInt(process.env.AGENT_TIMEOUT || "600000", 10),
    codexModel: process.env.CODEX_MODEL || "gpt-5.2-codex",
    apiModel: process.env.API_MODEL || "gpt-5.2",
  };
}

async function ensureClone(repoUrl: string, targetDir: string): Promise<string> {
  if (fs.existsSync(path.join(targetDir, ".git"))) {
    return targetDir;
  }

  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (!match) throw new Error(`Invalid GitHub URL: ${repoUrl}`);
  const repoName = match[2];

  const cloneDir = path.join(targetDir, repoName);
  if (fs.existsSync(path.join(cloneDir, ".git"))) {
    return cloneDir;
  }

  fs.mkdirSync(targetDir, { recursive: true });

  const spinner = ora(`Cloning ${repoUrl}...`).start();
  try {
    await execAsync(`git clone ${repoUrl} "${cloneDir}"`);
    spinner.succeed(`Cloned to ${cloneDir}`);
    return cloneDir;
  } catch (err) {
    spinner.fail("Clone failed");
    throw err;
  }
}

// ── Main CLI ──

const program = new Command();

program
  .name("living-repo")
  .description("Point an autonomous agent swarm at any GitHub repo")
  .version("0.1.0")
  .argument("<repo>", "GitHub repository URL (e.g., https://github.com/owner/repo)")
  .option("-c, --concurrency <n>", "Max parallel agents", "3")
  .option("-p, --path <dir>", "Local clone path (auto-clones if not provided)")
  .option("--no-tui", "Disable the Ink TUI (plain log output)")
  .option("--debug", "Write debug log to .living-repo-debug.jsonl")
  .action(async (repoUrl: string, opts: { concurrency: string; path?: string; tui?: boolean; debug?: boolean }) => {
    setupCleanExit();
    const concurrency = parseInt(opts.concurrency, 10) || 3;

    let repoPath: string;
    if (opts.path) {
      repoPath = path.resolve(opts.path);
    } else {
      const tmpBase = path.join(process.env.TEMP || process.env.TMPDIR || "/tmp", "living-repo-clones");
      repoPath = await ensureClone(repoUrl, tmpBase);
    }

    const config = loadConfig(repoUrl, repoPath, concurrency);

    if (opts.debug) {
      bus.enableDebugLog(process.cwd());
    }

    if (opts.tui === false) {
      console.log(BANNER);
      console.log(chalk.hex("#93c5fd")(`  target: ${config.repoOwner}/${config.repoName}`));
      console.log(chalk.hex("#94a3b8")(`  path:   ${config.repoPath}`));
      console.log(chalk.hex("#94a3b8")(`  agents: ${config.maxConcurrency}`));
      console.log();

      bus.on("triage:issue", (e) => {
        console.log(chalk.hex("#94a3b8")(`  [triage] #${e.issueId}: ${e.classification}/${e.severity}`));
      });
      bus.on("agent:start", (e) => {
        console.log(chalk.hex("#c4b5fd")(`  [agent] Starting #${e.issueId}: ${e.title}`));
      });
      bus.on("agent:activity", (e) => {
        console.log(chalk.hex("#94a3b8")(`  [agent] #${e.issueId}: ${e.activity}`));
      });
      bus.on("pr:created", (e) => {
        console.log(chalk.hex("#86efac")(`  [pr] #${e.prNumber}: ${e.prUrl}`));
      });
      bus.on("pr:merged", (e) => {
        console.log(chalk.hex("#7dd3fc")(`  [merged] PR #${e.prNumber} auto-merged`));
      });
      bus.on("pr:merge_failed", (e) => {
        console.log(chalk.hex("#fcd34d")(`  [merge-fail] PR #${e.prNumber}: ${e.reason}`));
      });
      bus.on("propose:start", () => {
        console.log(chalk.hex("#a78bfa")(`  [proposer] Generating feature suggestion...`));
      });
      bus.on("propose:issue_created", (e) => {
        console.log(chalk.hex("#a78bfa")(`  [proposer] Created issue #${e.issueNumber}: ${e.title}`));
        console.log(chalk.hex("#a78bfa")(`             ${e.issueUrl}`));
      });
      bus.on("propose:done", () => {
        console.log(chalk.hex("#a78bfa")(`  [proposer] Feature suggestion posted as GitHub issue`));
      });
      bus.on("agent:failed", (e) => {
        console.log(chalk.hex("#fda4af")(`  [fail] #${e.issueId}: ${e.error}`));
      });
      bus.on("error", (e) => {
        console.log(chalk.hex("#fda4af")(`  [error] ${e.message}`));
      });

      const { runEngine } = await import("./engine.js");
      await runEngine(config);
    } else {
      const { default: App } = await import("./ui/App.js");
      const { runEngine } = await import("./engine.js");

      const instance = render(
        React.createElement(App, { repo: `${config.repoOwner}/${config.repoName}` }),
        { patchConsole: true, exitOnCtrlC: process.stdin.isTTY === true }
      );

      try {
        await runEngine(config);
      } catch (err) {
        bus.dispatch("error", { message: err instanceof Error ? err.message : String(err) });
      }

      await instance.waitUntilExit().catch(() => {});
      instance.unmount();
    }
  });

// Keep legacy subcommands for backward compat
program
  .command("triage")
  .description("Triage all open issues (debug mode)")
  .requiredOption("--repo <url>", "GitHub repository URL")
  .option("--path <dir>", "Local clone path", ".")
  .action(async (opts) => {
    console.log(BANNER);
    const config = loadConfig(opts.repo, opts.path, 1);
    const { triageOnly } = await import("./orchestrator.js");
    const spinner = ora("Triaging issues...").start();
    try {
      await triageOnly(config);
      spinner.succeed("Triage complete");
    } catch (err) {
      spinner.fail("Triage failed");
      console.error(err);
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Show repo status")
  .requiredOption("--repo <url>", "GitHub repository URL")
  .option("--path <dir>", "Local clone path", ".")
  .action(async (opts) => {
    console.log(BANNER);
    const config = loadConfig(opts.repo, opts.path, 1);
    const { initGitHub, fetchIssues, fetchPRsByLabel } = await import("./utils/github.js");
    initGitHub(config.githubToken);

    console.log(chalk.bold("Repository:"), `${config.repoOwner}/${config.repoName}\n`);
    const spinner = ora("Fetching status...").start();
    const issues = await fetchIssues(config.repoOwner, config.repoName, "open");
    const prs = await fetchPRsByLabel(config.repoOwner, config.repoName, "living-repo");
    spinner.succeed("Status loaded\n");
    console.log(chalk.bold("Open issues:"), issues.length);
    console.log(chalk.bold("Living Repo PRs:"), prs.length);
    console.log(`  Open: ${prs.filter((p) => p.state === "open").length}`);
    console.log(`  Closed/Merged: ${prs.filter((p) => p.state === "closed").length}`);
  });

program.parse();
