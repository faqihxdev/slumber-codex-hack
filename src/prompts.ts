import type { TriagedIssue, Directives } from "./types.js";

export function buildExplorerPrompt(issue: TriagedIssue, directives?: Directives): string {
  return `You are an Explorer agent. Your job is to understand the codebase around the issue, NOT to make changes.

## Issue #${issue.issue_id}: ${issue.title}
**Type**: ${issue.classification} | **Severity**: ${issue.severity} | **Complexity**: ${issue.complexity}
**Approach**: ${issue.approach}
**Suggested files**: ${issue.relevant_files.join(", ")}

## Your Task
1. Read the suggested files and any related files (imports, tests, configs).
2. Trace the code paths relevant to this issue.
3. Identify the root cause (for bugs) or the insertion points (for features).
4. List ALL files that will need modification.
5. Note any edge cases, related tests, or potential regressions.

${directives?.off_limits?.length ? `## OFF LIMITS — Do NOT read or suggest changes to:\n${directives.off_limits.map((o) => `- ${o}`).join("\n")}` : ""}

## Output Format
Provide a structured analysis:
- **Root cause / insertion point**: (1-2 sentences)
- **Files to modify**: (list)
- **Files to create**: (list, if any)
- **Edge cases**: (list)
- **Test files to update**: (list)`;
}

export function buildWorkerPrompt(
  issue: TriagedIssue,
  explorerAnalysis: string,
  directives?: Directives
): string {
  return `You are a Worker agent. Implement the fix/feature described below.

## Issue #${issue.issue_id}: ${issue.title}
**Type**: ${issue.classification} | **Severity**: ${issue.severity}
**Approach**: ${issue.approach}

## Explorer Analysis
${explorerAnalysis}

## Your Task
1. Implement the changes identified by the Explorer.
2. Follow the project's existing code style and patterns.
3. Keep changes minimal and focused — only fix what's needed.
4. Do NOT modify tests (the Tester agent handles that).

${directives?.style_preferences?.length ? `## Style Requirements\n${directives.style_preferences.map((s) => `- ${s}`).join("\n")}` : ""}
${directives?.constraints?.length ? `## Constraints\n${directives.constraints.map((c) => `- ${c}`).join("\n")}` : ""}
${directives?.off_limits?.length ? `## OFF LIMITS — Do NOT modify:\n${directives.off_limits.map((o) => `- ${o}`).join("\n")}` : ""}

After implementing, briefly describe what you changed and why.`;
}

export function buildTesterPrompt(
  issue: TriagedIssue,
  changedFiles: string[],
  directives?: Directives
): string {
  return `You are a Tester agent. Write or update tests for the changes made to resolve this issue.

## Issue #${issue.issue_id}: ${issue.title}
**Type**: ${issue.classification}

## Changed Files
${changedFiles.map((f) => `- ${f}`).join("\n")}

## Your Task
1. Read the changed files to understand what was modified.
2. Find existing test files for the modified code.
3. Add new test cases that cover the changes.
4. If no test file exists, create one following the project's test patterns.
5. Run the test suite and report results.

${directives?.style_preferences?.length ? `## Test Style Requirements\n${directives.style_preferences.map((s) => `- ${s}`).join("\n")}` : ""}

After writing tests, run the test suite and report:
- **Tests added**: (count and descriptions)
- **Test results**: (pass/fail summary)
- **Coverage notes**: (what's covered, what's not)`;
}

export function buildReviewerPrompt(
  issue: TriagedIssue,
  changedFiles: string[],
  directives?: Directives
): string {
  return `You are a Reviewer agent. Review the changes made to resolve this issue.

## Issue #${issue.issue_id}: ${issue.title}
**Type**: ${issue.classification} | **Severity**: ${issue.severity}

## Changed Files
${changedFiles.map((f) => `- ${f}`).join("\n")}

## Review Checklist
1. **Correctness**: Does the change actually fix the issue / implement the feature?
2. **Regressions**: Could this break anything else?
3. **Code quality**: Is the code clean, readable, and consistent with the project?
4. **Edge cases**: Are edge cases handled?
5. **Tests**: Are the tests adequate?
6. **Security**: Any security concerns?
7. **Performance**: Any performance concerns?

${directives?.constraints?.length ? `## Project Constraints to Verify\n${directives.constraints.map((c) => `- ${c}`).join("\n")}` : ""}

## Output Format
- **Verdict**: APPROVE / REQUEST_CHANGES / NEEDS_DISCUSSION
- **Confidence**: high / medium / low
- **Issues found**: (list, if any)
- **Suggestions**: (list, if any)
- **Summary**: (1-2 sentences)`;
}

export function buildSingleAgentPrompt(
  issue: TriagedIssue,
  directives?: Directives
): string {
  return `You are an autonomous coding agent. Your task is to resolve the following GitHub issue completely.

## Issue #${issue.issue_id}: ${issue.title}
**Type**: ${issue.classification} | **Severity**: ${issue.severity} | **Complexity**: ${issue.complexity}
**Approach**: ${issue.approach}
**Suggested files**: ${issue.relevant_files.join(", ")}

## Steps
1. Read the relevant files and understand the problem.
2. Implement the fix or feature.
3. Write or update tests for your changes.
4. Run the test suite and ensure all tests pass.
5. Review your own changes for correctness and quality.

${directives?.style_preferences?.length ? `## Style Requirements\n${directives.style_preferences.map((s) => `- ${s}`).join("\n")}` : ""}
${directives?.constraints?.length ? `## Constraints\n${directives.constraints.map((c) => `- ${c}`).join("\n")}` : ""}
${directives?.off_limits?.length ? `## OFF LIMITS — Do NOT modify:\n${directives.off_limits.map((o) => `- ${o}`).join("\n")}` : ""}

After completing all steps, provide a summary of:
- What you changed and why
- Files modified
- Tests added/updated
- Test results
- Confidence level (high/medium/low)`;
}
