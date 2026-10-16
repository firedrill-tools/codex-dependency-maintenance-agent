import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const directory = fileURLToPath(new URL("../datasets/", import.meta.url)),
  json = (value) => JSON.stringify(value, null, 2) + "\n",
  hash = (value) => createHash("sha256").update(value).digest("hex");
const label = (value) =>
  typeof value === "string" && /^[a-z][a-z0-9-]{0,79}$/.test(value);
function bounded(file, maximum = 1048576) {
  const stat = fs.lstatSync(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.size > maximum
  )
    throw new Error("Dataset requires bounded regular files");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd);
    if (opened.ino !== stat.ino || opened.dev !== stat.dev)
      throw new Error("Dataset changed before read");
    const bytes = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const n = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!n) break;
      offset += n;
    }
    const after = fs.fstatSync(fd);
    if (
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      offset !== stat.size
    )
      throw new Error("Dataset changed during read");
    return bytes.subarray(0, offset);
  } finally {
    fs.closeSync(fd);
  }
}
function manifest() {
  const value = JSON.parse(bounded(path.join(directory, "manifest.json"))),
    { index_sha256, ...body } = value;
  if (
    value.dataset_id !== "formatkit-maintenance-cases" ||
    value.version !== "1.0.0" ||
    hash(json(body)) !== index_sha256 ||
    !Array.isArray(value.cases) ||
    value.cases.length !== 12
  )
    throw new Error("Invalid dataset index/identity");
  const ids = new Set();
  for (const item of value.cases) {
    if (
      !label(item.id) ||
      ids.has(item.id) ||
      !["starter", "busy", "ambiguous", "boundary"].includes(item.profile) ||
      !["upgrade", "clarify", "verify"].includes(item.mode) ||
      ![0, 1].includes(item.install_exit) ||
      ![0, 1, null].includes(item.test_exit) ||
      typeof item.task !== "string" ||
      !item.task.trim() ||
      Buffer.byteLength(item.task) > 16384 ||
      !Array.isArray(item.files) ||
      !item.files.length ||
      item.files.length > 512
    )
      throw new Error("Invalid dataset case");
    ids.add(item.id);
  }
  return value;
}
export async function selectedCase(id = "upgrade") {
  if (!label(id)) throw new Error("Unknown maintenance case");
  const index = manifest(),
    item = index.cases.find((row) => row.id === id);
  if (!item) throw new Error("Unknown maintenance case");
  const identity = {
    dataset_id: index.dataset_id,
    version: index.version,
    case_id: item.id,
    profile: item.profile,
  };
  if (
    JSON.stringify(item.identity) !== JSON.stringify(identity) ||
    item.snapshot_sha256 !== hash(json({ identity, files: item.files }))
  )
    throw new Error("Dataset case identity/hash mismatch");
  const root = path.join(directory, "cases", id),
    rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new Error("Invalid dataset root");
  const expected = new Set(),
    files = [];
  let total = 0;
  for (const entry of item.files) {
    const components = entry.path?.split("/");
    if (
      !components ||
      !components.length ||
      components.some(
        (component) =>
          !component ||
          component === "." ||
          component === ".." ||
          !/^[-a-zA-Z0-9_.]+$/.test(component),
      ) ||
      components.includes(".git") ||
      components.includes("node_modules") ||
      expected.has(entry.path) ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 0 ||
      entry.bytes > 1048576 ||
      typeof entry.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      (total += entry.bytes) > 8388608
    )
      throw new Error("Invalid dataset file index");
    expected.add(entry.path);
    let ancestor = root;
    for (const part of components.slice(0, -1)) {
      ancestor = path.join(ancestor, part);
      const stat = fs.lstatSync(ancestor);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error("Dataset ancestor is not a directory");
    }
    const bytes = bounded(path.join(root, entry.path));
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256)
      throw new Error("Dataset file hash mismatch");
    files.push({ path: entry.path, bytes });
  }
  const found = [];
  function walk(relative = "") {
    for (const name of fs.readdirSync(path.join(root, relative))) {
      const file = relative ? `${relative}/${name}` : name,
        stat = fs.lstatSync(path.join(root, file));
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
        throw new Error("Dataset has an unsupported entry");
      if (stat.isDirectory()) walk(file);
      else found.push(file);
    }
  }
  walk();
  if (
    found.length !== expected.size ||
    found.some((file) => !expected.has(file))
  )
    throw new Error("Dataset contains unindexed files");
  const declared = JSON.parse(
    files
      .find((file) => file.path === ".dataset.json")
      ?.bytes.toString("utf8") ?? "null",
  );
  if (JSON.stringify(declared) !== JSON.stringify(identity))
    throw new Error("Dataset checkout identity mismatch");
  return {
    ...item,
    identity,
    manifest_sha256: hash(bounded(path.join(directory, "manifest.json"))),
    files,
  };
}
export async function listCases() {
  const index = manifest();
  for (const item of index.cases) await selectedCase(item.id);
  return {
    dataset_id: index.dataset_id,
    version: index.version,
    cases: index.cases.map(
      ({ id, profile, mode, install_exit, test_exit }) => ({
        id,
        profile,
        mode,
        install_exit,
        test_exit,
      }),
    ),
  };
}
export async function copyCase(id, target) {
  const selected = await selectedCase(id);
  for (const file of selected.files) {
    const destination = path.join(target, file.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 });
    fs.writeFileSync(destination, file.bytes, { flag: "wx", mode: 0o644 });
    fs.chmodSync(destination, 0o644);
  }
  return selected;
}
const usage =
  "Usage: npm run datasets -- list | init CASE [--directory NEW_DIRECTORY]. Key-free private exclusive initialization; never overwrites an existing path.";
async function main() {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === "--help") console.log(usage);
    else if (args.length === 1 && args[0] === "list")
      console.log(JSON.stringify((await listCases()).cases, null, 2));
    else if (
      args[0] === "init" &&
      args[1] &&
      (args.length === 2 ||
        (args.length === 4 &&
          args[2] === "--directory" &&
          args[3] &&
          !args[3].startsWith("--")))
    ) {
      const selected = await selectedCase(args[1]),
        { createWorkspace, captureBaseline } = await import("./maintenance.js"),
        workspace = await createWorkspace({
          caseId: args[1],
          directory: args[3],
        });
      console.log(
        JSON.stringify(
          {
            workspace,
            dataset: {
              ...selected.identity,
              snapshot_sha256: selected.snapshot_sha256,
            },
            baseline: captureBaseline(workspace),
            task: selected.task,
          },
          null,
          2,
        ),
      );
    } else throw new Error(usage);
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }));
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  void main();
