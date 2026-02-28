import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";
import { logger } from "./utils/logger.js";
import type { LivingRepoConfig } from "./types.js";

function collectFileTree(dir: string, prefix = "", depth = 0, maxDepth = 3): string[] {
  if (depth > maxDepth) return [];
  const lines: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => !e.name.startsWith(".") && e.name !== "node_modules" && e.name !== "dist");
    for (const entry of entries) {
      lines.push(`${prefix}${entry.isDirectory() ? "📁" : "  "} ${entry.name}`);
      if (entry.isDirectory()) {
        lines.push(...collectFileTree(path.join(dir, entry.name), prefix + "  ", depth + 1, maxDepth));
      }
    }
  } catch { /* ignore permission errors */ }
  return lines;
}

function readFileSnippet(filePath: string, maxLines = 80): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n").slice(0, maxLines);
    return lines.join("\n");
  } catch { return null; }
}

export async function ingestRepo(config: LivingRepoConfig): Promise<string> {
  const contextPath = path.join(config.repoPath, "CODEBASE_CONTEXT.md");

  if (fs.existsSync(contextPath)) {
    const cached = fs.readFileSync(contextPath, "utf-8").trim();
    if (cached.length > 100) {
      logger.info("Ingester", `Using cached ${contextPath}`);
      return cached;
    }
  }

  logger.info("Ingester", `Analyzing repository: ${config.repoPath}`);

  const tree = collectFileTree(config.repoPath).join("\n");
  const readme = readFileSnippet(path.join(config.repoPath, "README.md")) || "(no README)";
  const pkg = readFileSnippet(path.join(config.repoPath, "package.json"), 50) || "(no package.json)";
  const tsconfig = readFileSnippet(path.join(config.repoPath, "tsconfig.json"), 30) || "";

  const prompt = `Analyze this repository and produce a concise CODEBASE_CONTEXT.md:

## File Tree
${tree}

## README.md
${readme}

## package.json
${pkg}

${tsconfig ? `## tsconfig.json\n${tsconfig}` : ""}

Produce a markdown document covering:
1. Project purpose (1-2 sentences)
2. Tech stack
3. Directory structure overview
4. How to run tests and build
5. Key patterns and conventions
6. Areas of complexity or technical debt`;

  const openai = new OpenAI({ apiKey: config.openaiApiKey });
  const response = await openai.chat.completions.create({
    model: config.apiModel,
    messages: [
      { role: "system", content: "You are a senior developer analyzing a codebase. Be concise and factual." },
      { role: "user", content: prompt },
    ],
    temperature: 0.3,
  });

  const summary = response.choices[0]?.message?.content || "Unable to generate summary.";

  fs.writeFileSync(contextPath, summary);
  logger.success("Ingester", `Wrote ${contextPath}`);

  return summary;
}

export async function generateSkills(
  config: LivingRepoConfig,
  context: string
): Promise<void> {
  const skillsDir = path.join(config.repoPath, ".agents", "skills", "project");
  fs.mkdirSync(skillsDir, { recursive: true });

  const openai = new OpenAI({ apiKey: config.openaiApiKey });
  const response = await openai.chat.completions.create({
    model: config.apiModel,
    messages: [
      { role: "system", content: "Generate a concise Codex agent skill file (SKILL.md) for this project." },
      { role: "user", content: `Based on this codebase context, generate a skill file:\n\n${context}\n\nInclude: project conventions, file naming patterns, test patterns, import conventions, error handling patterns, key abstractions.` },
    ],
    temperature: 0.3,
  });

  const skill = response.choices[0]?.message?.content || "";
  const skillPath = path.join(skillsDir, "SKILL.md");
  fs.writeFileSync(skillPath, skill);
  logger.success("Ingester", `Generated project skill: ${skillPath}`);
}
