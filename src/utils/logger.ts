import chalk from "chalk";

type LogLevel = "info" | "success" | "warn" | "error" | "debug" | "agent";

const PREFIXES: Record<LogLevel, string> = {
  info: chalk.blue("ℹ"),
  success: chalk.green("✔"),
  warn: chalk.yellow("⚠"),
  error: chalk.red("✖"),
  debug: chalk.gray("⋯"),
  agent: chalk.magenta("⚙"),
};

function timestamp(): string {
  return chalk.gray(new Date().toISOString().slice(11, 19));
}

function log(level: LogLevel, component: string, message: string, data?: unknown): void {
  const prefix = PREFIXES[level];
  const comp = chalk.cyan(`[${component}]`);
  const line = `${timestamp()} ${prefix} ${comp} ${message}`;
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
  if (data !== undefined) {
    console.log(chalk.gray(JSON.stringify(data, null, 2)));
  }
}

export const logger = {
  info: (component: string, message: string, data?: unknown) =>
    log("info", component, message, data),
  success: (component: string, message: string, data?: unknown) =>
    log("success", component, message, data),
  warn: (component: string, message: string, data?: unknown) =>
    log("warn", component, message, data),
  error: (component: string, message: string, data?: unknown) =>
    log("error", component, message, data),
  debug: (component: string, message: string, data?: unknown) =>
    log("debug", component, message, data),
  agent: (component: string, message: string, data?: unknown) =>
    log("agent", component, message, data),
};
