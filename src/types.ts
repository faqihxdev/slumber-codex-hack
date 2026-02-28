import { z } from "zod";

// ── Issue Classification ──

export const ClassificationEnum = z.enum([
  "bug",
  "feature",
  "refactor",
  "docs",
  "test",
  "chore",
]);
export type Classification = z.infer<typeof ClassificationEnum>;

export const SeverityEnum = z.enum(["critical", "high", "medium", "low"]);
export type Severity = z.infer<typeof SeverityEnum>;

export const ComplexityEnum = z.enum(["S", "M", "L"]);
export type Complexity = z.infer<typeof ComplexityEnum>;

export const ConfidenceEnum = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof ConfidenceEnum>;

// ── Triaged Issue ──

export const TriagedIssueSchema = z.object({
  issue_id: z.number(),
  title: z.string(),
  classification: ClassificationEnum,
  severity: SeverityEnum,
  complexity: ComplexityEnum,
  relevant_files: z.array(z.string()),
  dependencies: z.array(z.number()).default([]),
  approach: z.string(),
  confidence: ConfidenceEnum,
});
export type TriagedIssue = z.infer<typeof TriagedIssueSchema>;

// ── GitHub Issue (raw) ──

export const GitHubIssueSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullable().default(""),
  labels: z.array(
    z.union([z.string(), z.object({ name: z.string().optional() })])
  ),
  state: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  reactions: z
    .object({
      total_count: z.number().default(0),
    })
    .optional(),
  comments: z.number().default(0),
});
export type GitHubIssue = z.infer<typeof GitHubIssueSchema>;

// ── Queue Item ──

export const QueueItemSchema = z.object({
  issue: TriagedIssueSchema,
  priority_score: z.number(),
  status: z.enum(["pending", "in_progress", "completed", "failed", "skipped"]),
  assigned_worker: z.string().optional(),
  worktree_path: z.string().optional(),
  started_at: z.string().optional(),
  completed_at: z.string().optional(),
});
export type QueueItem = z.infer<typeof QueueItemSchema>;

// ── Worker Result ──

export const WorkerResultSchema = z.object({
  issue_id: z.number(),
  success: z.boolean(),
  branch_name: z.string(),
  files_changed: z.array(z.string()),
  test_results: z.string().optional(),
  summary: z.string(),
  confidence: ConfidenceEnum,
  error: z.string().optional(),
});
export type WorkerResult = z.infer<typeof WorkerResultSchema>;

// ── PR Result ──

export const PRResultSchema = z.object({
  issue_id: z.number(),
  pr_number: z.number(),
  pr_url: z.string(),
  title: z.string(),
  status: z.enum(["open", "merged", "closed"]),
  created_at: z.string(),
});
export type PRResult = z.infer<typeof PRResultSchema>;

// ── Directives ──

export const DirectivesSchema = z.object({
  focus_areas: z.array(z.string()).default([]),
  off_limits: z.array(z.string()).default([]),
  style_preferences: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
  feature_guidance: z.array(z.string()).default([]),
  communication: z.array(z.string()).default([]),
});
export type Directives = z.infer<typeof DirectivesSchema>;

// ── Feature Proposal ──

export const FeatureProposalSchema = z.object({
  title: z.string(),
  description: z.string(),
  user_benefit: z.string(),
  complexity: ComplexityEnum,
  implementation_sketch: z.string(),
  priority_score: z.number().min(1).max(10),
});
export type FeatureProposal = z.infer<typeof FeatureProposalSchema>;

export const ProposalSetSchema = z.object({
  proposals: z.array(FeatureProposalSchema),
});
export type ProposalSet = z.infer<typeof ProposalSetSchema>;

// ── Review Feedback ──

export const ReviewFeedbackSchema = z.object({
  pr_number: z.number(),
  reviewer: z.string(),
  body: z.string(),
  submitted_at: z.string(),
});
export type ReviewFeedback = z.infer<typeof ReviewFeedbackSchema>;

// ── Config ──

export interface LivingRepoConfig {
  repoOwner: string;
  repoName: string;
  repoPath: string;
  githubToken: string;
  openaiApiKey: string;
  maxConcurrency: number;
  agentTimeout: number;
  /** Model for Codex SDK agent work (triage, resolution, ingestion). Default: gpt-5.2-codex */
  codexModel: string;
  /** Model for lightweight OpenAI API calls (feedback extraction, proposals). Default: gpt-5.2 */
  apiModel: string;
}

// ── Severity weight map for priority scoring ──

export const SEVERITY_WEIGHTS: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export const COMPLEXITY_WEIGHTS: Record<Complexity, number> = {
  S: 1,
  M: 2,
  L: 3,
};
