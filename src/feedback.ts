import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";
import { logger } from "./utils/logger.js";
import { fetchReviews, fetchPRsByLabel } from "./utils/github.js";
import type { LivingRepoConfig, ReviewFeedback } from "./types.js";

let openai: OpenAI;

function getOpenAI(apiKey: string): OpenAI {
  if (!openai) {
    openai = new OpenAI({ apiKey });
  }
  return openai;
}

const EXTRACT_LEARNINGS_PROMPT = `You are analyzing PR review comments to extract actionable coding rules and preferences.

For each review comment, extract:
1. A clear, specific rule that should be followed in future work
2. The category: "style", "testing", "architecture", "security", "performance", "naming", or "other"
3. The importance: "high" (must follow), "medium" (should follow), "low" (nice to have)

Return a JSON object with an array of "learnings", each with fields: rule, category, importance.
Only extract concrete, actionable rules. Skip vague praise or unclear comments.
If no actionable rules can be extracted, return {"learnings": []}.`;

interface Learning {
  rule: string;
  category: string;
  importance: string;
  source_pr: number;
  source_reviewer: string;
  extracted_at: string;
}

export async function extractLearnings(
  feedbacks: ReviewFeedback[],
  config: LivingRepoConfig
): Promise<Learning[]> {
  if (feedbacks.length === 0) return [];

  const ai = getOpenAI(config.openaiApiKey);
  const combinedFeedback = feedbacks
    .map(
      (f) => `[PR #${f.pr_number} by @${f.reviewer}]: ${f.body}`
    )
    .join("\n\n");

  logger.info("Feedback", `Analyzing ${feedbacks.length} review comments for learnings`);

  const response = await ai.chat.completions.create({
    model: config.apiModel,
    messages: [
      { role: "system", content: EXTRACT_LEARNINGS_PROMPT },
      { role: "user", content: combinedFeedback },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) return [];

  const parsed = JSON.parse(raw);
  const learnings: Learning[] = (parsed.learnings || []).map(
    (l: { rule: string; category: string; importance: string }, idx: number) => ({
      rule: l.rule,
      category: l.category,
      importance: l.importance,
      source_pr: feedbacks[0]?.pr_number || 0,
      source_reviewer: feedbacks[0]?.reviewer || "unknown",
      extracted_at: new Date().toISOString(),
    })
  );

  logger.success("Feedback", `Extracted ${learnings.length} learnings`);
  return learnings;
}

export function saveLearnings(repoPath: string, learnings: Learning[]): void {
  const skillsDir = path.join(repoPath, ".agents", "skills", "learned");
  fs.mkdirSync(skillsDir, { recursive: true });

  const skillFile = path.join(skillsDir, "SKILL.md");
  let existing = "";
  if (fs.existsSync(skillFile)) {
    existing = fs.readFileSync(skillFile, "utf-8");
  }

  const newRules = learnings
    .filter((l) => !existing.includes(l.rule))
    .map(
      (l) =>
        `- **[${l.category}/${l.importance}]** ${l.rule} _(from PR #${l.source_pr} by @${l.source_reviewer})_`
    );

  if (newRules.length === 0) {
    logger.info("Feedback", "No new learnings to save");
    return;
  }

  const content = existing
    ? `${existing}\n${newRules.join("\n")}\n`
    : `# Learned Preferences\n\n> Auto-generated from PR review feedback. The Living Repo uses these rules for future work.\n\n${newRules.join("\n")}\n`;

  fs.writeFileSync(skillFile, content);
  logger.success("Feedback", `Saved ${newRules.length} new learnings to ${skillFile}`);
}

export async function processFeedback(config: LivingRepoConfig): Promise<number> {
  logger.info("Feedback", "Checking for review feedback on living-repo PRs");

  const prs = await fetchPRsByLabel(
    config.repoOwner,
    config.repoName,
    "living-repo"
  );

  let totalLearnings = 0;

  for (const pr of prs) {
    try {
      const reviews = await fetchReviews(
        config.repoOwner,
        config.repoName,
        pr.number
      );

      if (reviews.length === 0) continue;

      const learnings = await extractLearnings(reviews, config);
      if (learnings.length > 0) {
        saveLearnings(config.repoPath, learnings);
        totalLearnings += learnings.length;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Feedback", `Error processing PR #${pr.number}: ${msg}`);
    }
  }

  logger.success("Feedback", `Processed feedback: ${totalLearnings} total learnings`);
  return totalLearnings;
}
