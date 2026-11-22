import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

export async function runProgram(program: string, args: string[], signal: AbortSignal, cwd?: string) {
  try {
    return await execute(program, args, { cwd, timeout: 60000, killSignal: "SIGKILL", signal, maxBuffer: 128 * 1024 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("Install " + program + " and make it available on the MCP server PATH");
    }
    throw error;
  }
}


let rendering = false;

export async function withRenderSlot<T>(work: () => Promise<T>) {
  if (rendering) throw new Error("A render is already running. Retry when it completes.");
  rendering = true;
  try {
    return await work();
  } finally {
    rendering = false;
  }
}
