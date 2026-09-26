import { existsSync } from "node:fs";
import { win32 } from "node:path";

/**
 * powershell.exe 的完整路径。
 * 桌面客户端为了安全会把内置服务的 PATH 收窄成 Node 目录、System32 和 Windows 目录；
 * powershell.exe 在 System32\WindowsPowerShell\v1.0 下，按名字找不到，DPAPI 解密随之失败，
 * 桌面版因此一直读不出模型密钥、退回离线模式。按系统目录拼出完整路径，找不到再退回按名字查找。
 */
export function windowsPowerShellPath(env: NodeJS.ProcessEnv = process.env, exists: (path: string) => boolean = existsSync): string {
  const root = env.SystemRoot || env.SYSTEMROOT || env.windir || env.WINDIR || "C:\\Windows";
  const full = win32.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return exists(full) ? full : "powershell.exe";
}
