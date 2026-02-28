import { Octokit } from "@octokit/rest";
import { logger } from "./logger.js";
import type { LivingRepoConfig, ReviewFeedback } from "../types.js";

let octokit: Octokit;

export function initGitHub(token: string): void {
  octokit = new Octokit({ auth: token });
}

function getOctokit(): Octokit {
  if (!octokit) {
    throw new Error("GitHub not initialized. Call initGitHub(token) first.");
  }
  return octokit;
}

export interface RawGitHubIssue {
  number: number;
  title: string;
  body: string | null;
  labels: Array<string | { name?: string }>;
  state: string;
  created_at: string;
  updated_at: string;
  reactions?: { total_count: number };
  comments: number;
  pull_request?: unknown;
}

export async function fetchIssues(
  owner: string,
  repo: string,
  state: "open" | "closed" | "all" = "open"
): Promise<RawGitHubIssue[]> {
  const kit = getOctokit();
  logger.info("GitHub", `Fetching ${state} issues from ${owner}/${repo}`);

  const issues: RawGitHubIssue[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const { data } = await kit.issues.listForRepo({
      owner,
      repo,
      state,
      per_page: perPage,
      page,
    });

    if (data.length === 0) break;

    for (const issue of data) {
      if (issue.pull_request) continue;
      issues.push({
        number: issue.number,
        title: issue.title,
        body: issue.body ?? null,
        labels: issue.labels.map((l) =>
          typeof l === "string" ? l : { name: l.name }
        ),
        state: issue.state,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        reactions: issue.reactions
          ? { total_count: issue.reactions.total_count }
          : undefined,
        comments: issue.comments,
      });
    }

    if (data.length < perPage) break;
    page++;
  }

  logger.success("GitHub", `Fetched ${issues.length} issues`);
  return issues;
}

export async function createPR(
  owner: string,
  repo: string,
  opts: {
    title: string;
    body: string;
    head: string;
    base?: string;
    labels?: string[];
  }
): Promise<{ number: number; html_url: string }> {
  const kit = getOctokit();
  logger.info("GitHub", `Creating PR: ${opts.title}`);

  try {
    const { data: pr } = await kit.pulls.create({
      owner,
      repo,
      title: opts.title,
      body: opts.body,
      head: opts.head,
      base: opts.base || "main",
    });

    if (opts.labels && opts.labels.length > 0) {
      await kit.issues.addLabels({
        owner,
        repo,
        issue_number: pr.number,
        labels: opts.labels,
      });
    }

    logger.success("GitHub", `Created PR #${pr.number}: ${pr.html_url}`);
    return { number: pr.number, html_url: pr.html_url };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("A pull request already exists")) {
      logger.warn("GitHub", `PR already exists for ${opts.head}, finding it...`);
      const { data: existing } = await kit.pulls.list({
        owner, repo, head: `${owner}:${opts.head}`, state: "open",
      });
      if (existing.length > 0) {
        const pr = existing[0];
        await kit.pulls.update({
          owner, repo, pull_number: pr.number, title: opts.title, body: opts.body,
        });
        logger.success("GitHub", `Updated existing PR #${pr.number}: ${pr.html_url}`);
        return { number: pr.number, html_url: pr.html_url };
      }
    }
    throw err;
  }
}

export async function fetchReviews(
  owner: string,
  repo: string,
  prNumber: number
): Promise<ReviewFeedback[]> {
  const kit = getOctokit();
  logger.info("GitHub", `Fetching reviews for PR #${prNumber}`);

  const { data: reviews } = await kit.pulls.listReviews({
    owner,
    repo,
    pull_number: prNumber,
  });

  const feedbacks: ReviewFeedback[] = reviews
    .filter((r) => r.body && r.body.trim().length > 0)
    .map((r) => ({
      pr_number: prNumber,
      reviewer: r.user?.login || "unknown",
      body: r.body || "",
      submitted_at: r.submitted_at || new Date().toISOString(),
    }));

  const { data: comments } = await kit.pulls.listReviewComments({
    owner,
    repo,
    pull_number: prNumber,
  });

  for (const c of comments) {
    feedbacks.push({
      pr_number: prNumber,
      reviewer: c.user?.login || "unknown",
      body: c.body,
      submitted_at: c.created_at,
    });
  }

  logger.success("GitHub", `Found ${feedbacks.length} review items for PR #${prNumber}`);
  return feedbacks;
}

export async function addLabel(
  owner: string,
  repo: string,
  issueNumber: number,
  labels: string[]
): Promise<void> {
  const kit = getOctokit();
  await kit.issues.addLabels({
    owner,
    repo,
    issue_number: issueNumber,
    labels,
  });
  logger.info("GitHub", `Added labels [${labels.join(", ")}] to #${issueNumber}`);
}

export async function fetchPRsByLabel(
  owner: string,
  repo: string,
  label: string
): Promise<Array<{ number: number; state: string; title: string }>> {
  const kit = getOctokit();
  const { data: issues } = await kit.issues.listForRepo({
    owner,
    repo,
    labels: label,
    state: "all",
    per_page: 100,
  });

  return issues
    .filter((i) => i.pull_request)
    .map((i) => ({
      number: i.number,
      state: i.state,
      title: i.title,
    }));
}

export async function getDefaultBranch(
  owner: string,
  repo: string
): Promise<string> {
  const kit = getOctokit();
  const { data } = await kit.repos.get({ owner, repo });
  return data.default_branch;
}

export async function pushBranch(
  repoPath: string,
  branchName: string
): Promise<void> {
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);

  logger.info("GitHub", `Pushing branch ${branchName}`);
  await execAsync(`git push --force-with-lease origin ${branchName}`, { cwd: repoPath });
  logger.success("GitHub", `Pushed ${branchName}`);
}

export async function createIssue(
  owner: string,
  repo: string,
  opts: { title: string; body: string; labels?: string[] }
): Promise<{ number: number; html_url: string }> {
  const kit = getOctokit();
  logger.info("GitHub", `Creating issue: ${opts.title}`);

  const { data } = await kit.issues.create({
    owner,
    repo,
    title: opts.title,
    body: opts.body,
    labels: opts.labels,
  });

  logger.success("GitHub", `Created issue #${data.number}: ${data.html_url}`);
  return { number: data.number, html_url: data.html_url };
}

export async function mergePR(
  owner: string,
  repo: string,
  prNumber: number,
  mergeMethod: "merge" | "squash" | "rebase" = "squash"
): Promise<{ merged: boolean; message: string }> {
  const kit = getOctokit();
  logger.info("GitHub", `Merging PR #${prNumber} via ${mergeMethod}`);

  try {
    const { data } = await kit.pulls.merge({
      owner,
      repo,
      pull_number: prNumber,
      merge_method: mergeMethod,
    });

    if (data.merged) {
      logger.success("GitHub", `Merged PR #${prNumber}: ${data.sha}`);

      try {
        const { data: pr } = await kit.pulls.get({ owner, repo, pull_number: prNumber });
        await kit.git.deleteRef({ owner, repo, ref: `heads/${pr.head.ref}` });
        logger.info("GitHub", `Deleted branch ${pr.head.ref}`);
      } catch { /* branch cleanup is best-effort */ }

      return { merged: true, message: data.message || "Merged successfully" };
    }

    return { merged: false, message: data.message || "Merge returned false" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("GitHub", `Failed to merge PR #${prNumber}: ${msg}`);
    return { merged: false, message: msg };
  }
}
