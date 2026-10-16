import { spawnSync } from "node:child_process";
export function childEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (
      key === "NODE_TEST_CONTEXT" ||
      key.toLowerCase() === "npm_config_allow_scripts" ||
      key.startsWith("GIT_")
    )
      delete env[key];
  return env;
}
export function command(name, args, cwd, timeout = 30000) {
  if (name === "git")
    args = [
      "--no-replace-objects",
      "--no-optional-locks",
      "--git-dir",
      `${cwd}/.git`,
      "--work-tree",
      cwd,
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.filemode=true",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ];
  const result = spawnSync(name, args, {
    cwd,
    encoding: "utf8",
    timeout,
    env: childEnvironment(),
    maxBuffer: 1048576,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    exitCode: result.status,
    signal: result.signal,
    error: result.error
      ? { code: result.error.code ?? null, message: result.error.message }
      : null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
  };
}
export const succeeded = (result) =>
  Boolean(result) && result.exitCode === 0 && !result.signal && !result.error;
