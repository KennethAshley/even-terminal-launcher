import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function terminateWindowsProcessTree(
  pid: number,
  force: boolean,
  execute: typeof execFileAsync = execFileAsync
): Promise<void> {
  const args = ["/PID", String(pid), "/T"];
  if (force) args.push("/F");
  try {
    await execute("taskkill.exe", args, {
      windowsHide: true,
      timeout: 5_000
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ESRCH") throw error;
  }
}
