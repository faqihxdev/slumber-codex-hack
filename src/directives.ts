import * as fs from "fs";
import * as path from "path";
import { logger } from "./utils/logger.js";
import type { Directives } from "./types.js";
import { DirectivesSchema } from "./types.js";

const DIRECTIVES_FILE = "DIRECTIVES.md";

function extractSection(content: string, heading: string): string[] {
  const headingPattern = new RegExp(
    `^## ${heading}\\s*$`,
    "mi"
  );
  const match = content.match(headingPattern);
  if (!match || match.index === undefined) return [];

  const start = match.index + match[0].length;
  const nextHeading = content.indexOf("\n## ", start);
  const section =
    nextHeading === -1
      ? content.slice(start)
      : content.slice(start, nextHeading);

  const items: string[] = [];
  for (const line of section.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- ")) {
      items.push(trimmed.slice(2).trim());
    }
  }
  return items;
}

export function parseDirectives(content: string): Directives {
  const directives: Directives = {
    focus_areas: extractSection(content, "Current Focus"),
    off_limits: extractSection(content, "Off Limits"),
    style_preferences: extractSection(content, "Style Preferences"),
    constraints: extractSection(content, "Constraints"),
    feature_guidance: extractSection(content, "Feature Guidance"),
    communication: extractSection(content, "Communication"),
  };

  return DirectivesSchema.parse(directives);
}

export function loadDirectives(repoPath: string): Directives | null {
  const filePath = path.join(repoPath, DIRECTIVES_FILE);

  if (!fs.existsSync(filePath)) {
    logger.info("Directives", "No DIRECTIVES.md found — running without directives");
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const directives = parseDirectives(content);

    logger.success("Directives", "Loaded directives", {
      focus_areas: directives.focus_areas.length,
      off_limits: directives.off_limits.length,
      style_preferences: directives.style_preferences.length,
      constraints: directives.constraints.length,
      feature_guidance: directives.feature_guidance.length,
    });

    return directives;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Directives", `Failed to parse DIRECTIVES.md: ${msg}`);
    return null;
  }
}

export function watchDirectives(
  repoPath: string,
  onChange: (directives: Directives) => void
): () => void {
  const filePath = path.join(repoPath, DIRECTIVES_FILE);
  let lastContent = "";

  const check = (): void => {
    try {
      if (!fs.existsSync(filePath)) return;
      const content = fs.readFileSync(filePath, "utf-8");
      if (content !== lastContent) {
        lastContent = content;
        const directives = parseDirectives(content);
        onChange(directives);
        logger.info("Directives", "Detected DIRECTIVES.md change — reloading");
      }
    } catch {
      // skip errors during watch
    }
  };

  const interval = setInterval(check, 5000);
  check();

  return () => clearInterval(interval);
}
