import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { childEnvironment } from "../../src/commands.js";
export function upgrade(workspace) {
  const file = path.join(workspace, "package.json"),
    pkg = JSON.parse(fs.readFileSync(file));
  pkg.dependencies.formatkit = "file:vendor/formatkit-v2";
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2));
  const source = path.join(workspace, "src/report.js");
  fs.writeFileSync(
    source,
    fs
      .readFileSync(source, "utf8")
      .replace("import { formatMoney }", "import { formatCurrency }")
      .replace(
        "formatMoney(totalMinorUnits, currency)",
        "formatCurrency({ minorUnits: totalMinorUnits, currency })",
      ),
  );
  execFileSync("npm", ["install", "--offline", "--ignore-scripts"], {
    cwd: workspace,
    stdio: "pipe",
    env: childEnvironment(),
  });
  return {
    completed: true,
    finalResponse: "Controlled upgrade and lock generation completed.",
  };
}
