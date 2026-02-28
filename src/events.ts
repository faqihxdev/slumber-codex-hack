import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";

export type SwarmEventType =
  | "init:start"
  | "init:done"
  | "triage:start"
  | "triage:progress"
  | "triage:issue"
  | "triage:done"
  | "queue:update"
  | "agent:start"
  | "agent:activity"
  | "agent:file_change"
  | "agent:command"
  | "agent:done"
  | "agent:failed"
  | "pr:created"
  | "pr:merged"
  | "pr:merge_failed"
  | "pr:failed"
  | "propose:start"
  | "propose:done"
  | "propose:issue_created"
  | "feedback:learning"
  | "loop:start"
  | "loop:done"
  | "error";

export interface SwarmEvent {
  type: SwarmEventType;
  timestamp: number;
  [key: string]: unknown;
}

class SwarmEventBus extends EventEmitter {
  private logFile: string | null = null;
  private logStream: fs.WriteStream | null = null;

  enableDebugLog(dir: string): void {
    this.logFile = path.join(dir, ".living-repo-debug.jsonl");
    this.logStream = fs.createWriteStream(this.logFile, { flags: "a" });
  }

  emit(type: string, ...args: unknown[]): boolean {
    if (this.logStream && type !== "newListener" && type !== "removeListener") {
      const entry = {
        type,
        timestamp: Date.now(),
        data: args[0] ?? {},
      };
      this.logStream.write(JSON.stringify(entry) + "\n");
    }
    return super.emit(type, ...args);
  }

  dispatch(type: SwarmEventType, data: Record<string, unknown> = {}): void {
    this.emit(type, { type, timestamp: Date.now(), ...data });
  }

  close(): void {
    this.logStream?.end();
  }
}

export const bus = new SwarmEventBus();
