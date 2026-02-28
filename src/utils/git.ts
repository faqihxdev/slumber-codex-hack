import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";
import { logger } from "./logger.js";

const execAsync = promisify(exec);

const WORKTREE_DIR = ".living-repo-worktrees";

function worktreeBase(repoPath: string): string {
  return path.join(repoPath, WORKTREE_DIR);
}

export async function ensureWorktreeDir(repoPath: string): Promise<void> {
  const base = worktreeBase(repoPath);
  if (!fs.existsSync(base)) {
    fs.mkdirSync(base, { recursive: true });
  }

  const gitignorePath = path.join(base, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, "*\n");
  }
}

export function getWorktreePath(repoPath: string, issueId: number): string {
  return path.join(worktreeBase(repoPath), `issue-${issueId}`);
}

export function getBranchName(issueId: number): string {
  return `living-repo/issue-${issueId}`;
}

export async function createWorktree(
  repoPath: string,
  issueId: number,
  baseBranch: string = "main"
): Promise<string> {
  await ensureWorktreeDir(repoPath);
  const wtPath = getWorktreePath(repoPath, issueId);
  const branch = getBranchName(issueId);

  logger.info("Git", `Creating worktree for issue #${issueId} at ${wtPath}`);

  try {
    await execAsync(`git branch -D ${branch}`, { cwd: repoPath });
  } catch {
    // branch doesn't exist yet — fine
  }

  if (fs.existsSync(wtPath)) {
    logger.warn("Git", `Worktree path exists, cleaning up: ${wtPath}`);
    await deleteWorktree(repoPath, issueId);
  }

  await execAsync(
    `git worktree add -b ${branch} "${wtPath}" ${baseBranch}`,
    { cwd: repoPath }
  );

  logger.success("Git", `Created worktree: ${wtPath} on branch ${branch}`);
  return wtPath;
}

export async function deleteWorktree(
  repoPath: string,
  issueId: number
): Promise<void> {
  const wtPath = getWorktreePath(repoPath, issueId);
  const branch = getBranchName(issueId);

  logger.info("Git", `Removing worktree for issue #${issueId}`);

  try {
    await execAsync(`git worktree remove "${wtPath}" --force`, { cwd: repoPath });
  } catch {
    if (fs.existsSync(wtPath)) {
      fs.rmSync(wtPath, { recursive: true, force: true });
    }
    try {
      await execAsync(`git worktree prune`, { cwd: repoPath });
    } catch {
      // best effort
    }
  }

  try {
    await execAsync(`git branch -D ${branch}`, { cwd: repoPath });
  } catch {
    // branch may not exist
  }

  logger.success("Git", `Removed worktree for issue #${issueId}`);
}

export async function listWorktrees(
  repoPath: string
): Promise<Array<{ path: string; branch: string; commit: string }>> {
  const { stdout } = await execAsync("git worktree list --porcelain", {
    cwd: repoPath,
  });

  const worktrees: Array<{ path: string; branch: string; commit: string }> = [];
  const blocks = stdout.trim().split("\n\n");

  for (const block of blocks) {
    const lines = block.split("\n");
    let wtPath = "";
    let branch = "";
    let commit = "";

    for (const line of lines) {
      if (line.startsWith("worktree ")) wtPath = line.slice(9);
      else if (line.startsWith("branch ")) branch = line.slice(7);
      else if (line.startsWith("HEAD ")) commit = line.slice(5);
    }

    if (wtPath) {
      worktrees.push({ path: wtPath, branch, commit });
    }
  }

  return worktrees;
}

export async function getChangedFiles(worktreePath: string): Promise<string[]> {
  const { stdout: tracked } = await execAsync("git diff --name-only HEAD", {
    cwd: worktreePath,
  });
  const { stdout: untracked } = await execAsync(
    "git ls-files --others --exclude-standard",
    { cwd: worktreePath }
  );
  const files = new Set([
    ...tracked.trim().split("\n").filter(Boolean),
    ...untracked.trim().split("\n").filter(Boolean),
  ]);
  return [...files];
}

export async function commitAll(
  worktreePath: string,
  message: string
): Promise<void> {
  await execAsync("git add -A", { cwd: worktreePath });
  await execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
    cwd: worktreePath,
  });
  logger.success("Git", `Committed: ${message}`);
}

export async function getCurrentBranch(repoPath: string): Promise<string> {
  const { stdout } = await execAsync("git branch --show-current", {
    cwd: repoPath,
  });
  return stdout.trim();
}

export async function cleanupAllWorktrees(repoPath: string): Promise<void> {
  logger.info("Git", "Cleaning up all living-repo worktrees");
  const worktrees = await listWorktrees(repoPath);
  for (const wt of worktrees) {
    if (wt.branch.includes("living-repo/")) {
      const issueMatch = wt.branch.match(/issue-(\d+)/);
      if (issueMatch) {
        await deleteWorktree(repoPath, parseInt(issueMatch[1], 10));
      }
    }
  }
  logger.success("Git", "All worktrees cleaned up");
}
