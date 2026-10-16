import { spawn } from "node:child_process";
export const processAlive = (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw error;
  }
};
export const groupAlive = (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw error;
  }
};
const info = (error) => ({
  name: error?.name ?? "Error",
  message: error?.message ?? String(error),
  code: error?.code ?? null,
});
export async function runProcess({
  program,
  args = [],
  cwd,
  env,
  signal,
  timeoutMs = 30000,
  stdoutLimit = 1048576,
  stderrLimit = 1048576,
  stdinLimit = 16384,
  inputStream,
  onStdin,
  onStdout,
  onStderr,
  onState,
  termGraceMs = 200,
  cleanupMs = 5000,
}) {
  if (process.platform === "win32")
    throw new Error("Owned POSIX process groups required");
  for (const [name, value, max] of [
    ["timeoutMs", timeoutMs, 300000],
    ["stdoutLimit", stdoutLimit, 1048576],
    ["stderrLimit", stderrLimit, 1048576],
    ["stdinLimit", stdinLimit, 1048576],
  ])
    if (!Number.isSafeInteger(value) || value < 1 || value > max)
      throw new Error(`Invalid ${name}`);
  const lifecycle = {
    prepared_at: new Date().toISOString(),
    pid: null,
    pgid: null,
    spawned: false,
    exit_observed: false,
    close_observed: false,
    group_exit_confirmed: false,
    term_sent: false,
    kill_sent: false,
    reason: null,
    parent_listener_removed: false,
  };
  const stdout = [],
    stderr = [];
  let outBytes = 0,
    errBytes = 0,
    inBytes = 0,
    child,
    error = null,
    exitCode = null,
    exitSignal = null,
    stopAt = null,
    exitedAt = null,
    settled = false;
  if (signal?.aborted) {
    lifecycle.reason = info(signal.reason ?? new Error("Process cancelled"));
    lifecycle.group_exit_confirmed = true;
    lifecycle.parent_listener_removed = true;
    return {
      exitCode: null,
      signal: null,
      error: lifecycle.reason,
      stdout: "",
      stderr: "",
      lifecycle,
    };
  }
  return await new Promise((resolve) => {
    let interval, timer;
    const notify = () => {
      try {
        onState?.({ ...lifecycle });
      } catch (fault) {
        stop(fault);
      }
    };
    const send = (name) => {
      if (!lifecycle.pgid) return;
      try {
        process.kill(-lifecycle.pgid, name);
        if (name === "SIGTERM") lifecycle.term_sent = true;
        else lifecycle.kill_sent = true;
      } catch (fault) {
        if (!["ESRCH", "EPERM"].includes(fault.code)) error ??= info(fault);
      }
    };
    function stop(reason) {
      if (settled) return;
      if (stopAt === null) {
        error ??= info(reason);
        lifecycle.reason ??= info(reason);
        stopAt = performance.now();
        send("SIGTERM");
      }
    }
    const cancelled = () =>
      stop(signal.reason ?? new Error("Process cancelled"));
    const inputData = (bytes) => {
      if (settled || stopAt !== null) return;
      const buffer = Buffer.from(bytes);
      inBytes += buffer.length;
      if (inBytes > stdinLimit) {
        stop(new Error("Process stdin byte limit exceeded"));
        return;
      }
      try {
        onStdin?.(buffer);
        if (!child.stdin.write(buffer)) {
          inputStream.pause();
          child.stdin.once("drain", () => {
            if (!settled && stopAt === null) inputStream.resume();
          });
        }
      } catch (fault) {
        stop(fault);
      }
    };
    const inputEnd = () => child?.stdin?.end();
    function finish() {
      if (settled) return;
      settled = true;
      clearInterval(interval);
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancelled);
      lifecycle.parent_listener_removed = true;
      inputStream?.removeListener("data", inputData);
      inputStream?.removeListener("end", inputEnd);
      if (child) {
        child.removeAllListeners("error");
        child.on("error", () => {});
        child.stdout?.removeAllListeners("data");
        child.stderr?.removeAllListeners("data");
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.stdin?.destroy();
        if (!lifecycle.close_observed) child.unref();
      }
      lifecycle.finished_at = new Date().toISOString();
      try {
        onState?.({ ...lifecycle });
      } catch (fault) {
        error ??= info(fault);
      }
      resolve({
        exitCode,
        signal: exitSignal,
        error,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        lifecycle: { ...lifecycle },
      });
    }
    const check = () => {
      if (settled) return;
      let alive = false;
      try {
        alive = groupAlive(lifecycle.pgid);
      } catch (fault) {
        stop(fault);
        alive = true;
      }
      lifecycle.group_exit_confirmed = !alive;
      if (
        lifecycle.exit_observed &&
        alive &&
        stopAt === null &&
        performance.now() - exitedAt > 200
      )
        stop(new Error("Owned descendants outlived the command"));
      if (
        stopAt !== null &&
        alive &&
        performance.now() - stopAt >= termGraceMs &&
        !lifecycle.kill_sent
      ) {
        send("SIGKILL");
        notify();
      }
      if (lifecycle.close_observed && !alive) finish();
      else if (stopAt !== null && performance.now() - stopAt >= cleanupMs) {
        error ??= info(new Error("Process cleanup could not be confirmed"));
        finish();
      }
    };
    try {
      child = spawn(program, args, {
        cwd,
        env,
        detached: true,
        stdio: [inputStream ? "pipe" : "ignore", "pipe", "pipe"],
      });
      lifecycle.pid = child.pid ?? null;
      lifecycle.pgid = child.pid ?? null;
      child.on("error", (fault) => {
        error ??= info(fault);
        stop(fault);
      });
      child.once("spawn", () => {
        lifecycle.spawned = true;
        notify();
      });
      child.once("exit", (code, killed) => {
        exitCode = code;
        exitSignal = killed;
        lifecycle.exit_observed = true;
        exitedAt = performance.now();
        setImmediate(check);
      });
      child.once("close", () => {
        lifecycle.close_observed = true;
        check();
      });
      const capture = (chunks, maximum, kind, callback) => (bytes) => {
        if (settled) return;
        const buffer = Buffer.from(bytes),
          retained = kind === "stdout" ? outBytes : errBytes,
          part = buffer.subarray(0, Math.max(0, maximum - retained));
        if (part.length) {
          chunks.push(part);
          if (kind === "stdout") outBytes += part.length;
          else errBytes += part.length;
          try {
            callback?.(part);
          } catch (fault) {
            stop(fault);
          }
        }
        if (buffer.length > part.length)
          stop(new Error(`Process ${kind} byte limit exceeded`));
      };
      child.stdout.on("data", capture(stdout, stdoutLimit, "stdout", onStdout));
      child.stderr.on("data", capture(stderr, stderrLimit, "stderr", onStderr));
      child.stdin?.on("error", (fault) => {
        if (stopAt === null && !lifecycle.exit_observed) stop(fault);
      });
      if (inputStream) {
        inputStream.on("data", inputData);
        inputStream.once("end", inputEnd);
        if (inputStream.readableEnded) inputEnd();
      }
      signal?.addEventListener("abort", cancelled, { once: true });
      if (signal?.aborted) cancelled();
      timer = setTimeout(
        () => stop(new Error("Process deadline exceeded")),
        timeoutMs,
      );
      interval = setInterval(check, 20);
    } catch (fault) {
      error = info(fault);
      lifecycle.reason = info(fault);
      lifecycle.close_observed = true;
      lifecycle.group_exit_confirmed = true;
      finish();
    }
  });
}
