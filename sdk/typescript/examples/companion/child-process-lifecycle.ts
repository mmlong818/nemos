import { spawn, type ChildProcess } from "node:child_process";

export interface ProcessTreeTerminationCommand {
  command: string;
  args: string[];
  killProcessGroup: boolean;
}

export function processTreeTerminationCommand(pid: number, platform = process.platform): ProcessTreeTerminationCommand {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("无法停止没有有效进程号的开发任务。");
  return platform === "win32"
    ? { command: "taskkill", args: ["/PID", String(pid), "/T", "/F"], killProcessGroup: false }
    : { command: "", args: [], killProcessGroup: true };
}

/** 停止 CLI 及其派生命令，避免取消后编译器或包管理器继续留在后台。 */
export function terminateChildProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) {
    child.kill();
    return;
  }
  const command = processTreeTerminationCommand(pid);
  if (command.killProcessGroup) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
    return;
  }
  try {
    const killer = spawn(command.command, command.args, { windowsHide: true, detached: true, stdio: "ignore" });
    killer.unref();
  } catch {
    child.kill();
  }
}

export function detachedProcessGroup(platform = process.platform): boolean {
  return platform !== "win32";
}
