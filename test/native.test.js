import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Codex } from "@openai/codex-sdk";
import {
  runCodex,
  runMaintenance,
  verifyWorkspace,
} from "../src/maintenance.js";
import { saveReport } from "../src/evidence.js";
async function fixture(t, mode) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deps-native-")),
    child = path.join(directory, "synthetic-codex"),
    record = path.join(directory, "child.json");
  fs.writeFileSync(
    child,
    `#!${process.execPath}\n` +
      String.raw`
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const args=process.argv.slice(2),workspace=args[args.indexOf('--cd')+1],mode=process.env.SYNTHETIC_MODE;
fs.writeFileSync(process.env.CHILD_RECORD,JSON.stringify({pid:process.pid,args,runtime_home:process.env.CODEX_HOME??null,has_provider_key:Boolean(process.env.CODEX_API_KEY),env_keys:Object.keys(process.env)}));
process.stdin.resume();process.stdin.on('end',()=>{
 const send=value=>console.log(JSON.stringify(value));
 send({type:'thread.started',thread_id:'synthetic-thread',extra:'preserved'});
 if(mode!=='no-turn')send({type:'turn.started'});
 if(['upgrade','failed-after-edit','missing-terminal-after-edit'].includes(mode)){
  const file=path.join(workspace,'package.json'),pkg=JSON.parse(fs.readFileSync(file));pkg.dependencies.formatkit='file:vendor/formatkit-v2';fs.writeFileSync(file,JSON.stringify(pkg,null,2));
  const source=path.join(workspace,'src/report.js');fs.writeFileSync(source,fs.readFileSync(source,'utf8').replace('import { formatMoney }','import { formatCurrency }').replace('formatMoney(totalMinorUnits, currency)','formatCurrency({ minorUnits: totalMinorUnits, currency })'));
  execFileSync('npm',['install','--offline','--ignore-scripts'],{cwd:workspace,stdio:'pipe'});
  send({type:'item.completed',item:{id:'files',type:'file_change',status:'completed',changes:[{path:'src/report.js',kind:'update'}]}});
 }
 if(mode==='failed-after-edit'){send({type:'turn.failed',error:{message:'Controlled failure after upgrade'},reported:'retained'});return;}
 if(mode==='external'){send({type:'item.started',item:{id:'remote',type:'mcp_tool_call',status:'in_progress',server:'unknown',tool:'write'}});return;}
 if(mode==='unknown'){send({type:'mystery.event',value:1});return;}
 if(mode==='pending')send({type:'item.started',item:{id:'cmd',type:'command_execution',status:'in_progress',command:'npm test',aggregated_output:''}});
 send({type:'item.completed',item:{id:'answer',type:'agent_message',text:mode==='blank'?' ':'Controlled final answer'}});
 if(mode==='progress-before-tool')send({type:'item.completed',item:{id:'later-tool',type:'command_execution',status:'completed',command:'npm test',aggregated_output:'',exit_code:0}});
 if(mode==='replayed')send({type:'item.completed',item:{id:'answer',type:'agent_message',text:'Replayed final answer'}});
 if(mode==='oversized'){send({type:'item.completed',item:{id:'huge',type:'agent_message',text:'x'.repeat(1100000)}});return;}
 if(mode==='malformed'){console.log('{bad');return;}
 if(mode==='hang'){setInterval(()=>{},1000);return;}
 if(mode.startsWith('missing-terminal'))return;
 const usage=mode==='zero'?{input_tokens:0,output_tokens:0}:mode==='partial'?{input_tokens:7}:mode==='invalid'?{input_tokens:-1,output_tokens:'bad'}:{input_tokens:20,cached_input_tokens:2,output_tokens:5,reasoning_output_tokens:1,total_tokens:99};
 send({type:'turn.completed',usage});
 if(mode==='after-terminal')send({type:'item.completed',item:{id:'late',type:'agent_message',text:'late'}});
});
`,
    { mode: 0o700 },
  );
  const sdk = new Codex({
    codexPathOverride: child,
    env: { PATH: process.env.PATH, SYNTHETIC_MODE: mode, CHILD_RECORD: record },
  });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, child, record, sdk };
}
async function stopped(record) {
  const { pid } = JSON.parse(fs.readFileSync(record));
  for (let n = 0; n < 80; n++) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`SDK child remains alive: ${pid}`);
}
function cleanup(t, report) {
  for (const directory of [report.workspace, report.verification?.checkDir])
    if (directory)
      t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
}

test("actual SDK executable protocol upgrades and validates a fresh lock while retaining complete SDK events", async (t) => {
  const f = await fixture(t, "upgrade"),
    report = await runMaintenance({
      outputRoot: f.directory,
      agent: (workspace, options) =>
        runCodex(workspace, { ...options, sdk: f.sdk }),
    });
  cleanup(t, report);
  assert.equal(report.passed, true, JSON.stringify(report));
  assert.equal(report.agentResult.completed, true);
  assert.equal(report.agentResult.events[0].extra, "preserved");
  assert.equal(report.agentResult.usage.cache_write_input_tokens, 0);
  assert.match(report.agentResult.usage_source, /SDK-defaulted/);
  assert.equal(
    report.agentResult.sdk_usage_measurements.total_tokens.value,
    99,
  );
  assert.equal(report.agentResult.provider_usage.totals, null);
  assert.equal(report.agentResult.cost_usd, null);
  assert.deepEqual(report.verification.paths, [
    "package-lock.json",
    "package.json",
    "src/report.js",
  ]);
  const record = JSON.parse(fs.readFileSync(f.record));
  for (const value of [
    "workspace-write",
    'approval_policy="never"',
    "sandbox_workspace_write.network_access=false",
    'web_search="disabled"',
  ])
    assert.ok(record.args.includes(value));
  assert.deepEqual(JSON.parse(fs.readFileSync(report.reportPath)), report);
  assert.equal(fs.statSync(report.reportPath).mode & 0o777, 0o600);
  assert.equal(
    fs.statSync(path.dirname(report.reportPath)).mode & 0o777,
    0o700,
  );
  await stopped(f.record);
});
for (const mode of [
  "missing-terminal",
  "no-turn",
  "blank",
  "pending",
  "replayed",
  "progress-before-tool",
  "unknown",
  "external",
  "malformed",
  "oversized",
  "after-terminal",
  "hang",
])
  test(
    `actual SDK ${mode} fails without accepting a final answer`,
    { timeout: 10000 },
    async (t) => {
      const f = await fixture(t, mode);
      let observation;
      await assert.rejects(
        runCodex(f.directory, {
          sdk: f.sdk,
          timeoutMs: mode === "hang" ? 1000 : 5000,
          onObservation: (value) => {
            observation = structuredClone(value);
          },
        }),
      );
      assert.equal(observation.completed, false);
      assert.equal(observation.cleanup_requested, true);
      assert.ok(observation.events.length > 0);
      if (mode === "external")
        assert.equal(observation.external_effect_status, "unknown");
      await stopped(f.record);
    },
  );
for (const mode of ["failed-after-edit", "missing-terminal-after-edit"])
  test(`native ${mode} retains actual completed upgrade but cannot pass the overall run`, async (t) => {
    const f = await fixture(t, mode),
      report = await runMaintenance({
        outputRoot: f.directory,
        agent: (workspace, options) =>
          runCodex(workspace, { ...options, sdk: f.sdk }),
      });
    cleanup(t, report);
    assert.equal(report.passed, false);
    assert.equal(report.agentResult.completed, false);
    assert.ok(report.agentError);
    assert.equal(
      report.verification.passed,
      true,
      JSON.stringify(report.verification),
    );
    assert.deepEqual(report.verification.paths, [
      "package-lock.json",
      "package.json",
      "src/report.js",
    ]);
    assert.deepEqual(JSON.parse(fs.readFileSync(report.reportPath)), report);
    await stopped(f.record);
  });
for (const mode of ["zero", "partial", "invalid"])
  test(`SDK ${mode} usage stays separately labeled with unknown provider cost`, async (t) => {
    const f = await fixture(t, mode),
      result = await runCodex(f.directory, { sdk: f.sdk });
    assert.equal(result.cost_usd, null);
    assert.equal(result.provider_usage.status, "unknown");
    assert.equal(
      result.sdk_usage_measurements.input_tokens.state,
      mode === "invalid" ? "invalid" : "observed",
    );
    assert.equal(
      result.sdk_usage_measurements.input_tokens.value,
      mode === "zero" ? 0 : mode === "partial" ? 7 : null,
    );
    assert.equal(result.sdk_usage_measurements.total_tokens.state, "unknown");
    assert.equal(
      result.sdk_usage_measurements.cached_input_tokens.state,
      "unknown",
    );
    await stopped(f.record);
  });

test("owned isolated configuration excludes caller credentials/settings and removes its private home", async (t) => {
  const f = await fixture(t, "upgrade");
  let configuration;
  const report = await runMaintenance({
    outputRoot: f.directory,
    agent: (workspace, options) =>
      runCodex(workspace, {
        ...options,
        apiKey: "synthetic-private-key",
        sdkFactory: (input) => {
          configuration = input;
          return new Codex({
            ...input,
            codexPathOverride: f.child,
            env: {
              ...input.env,
              SYNTHETIC_MODE: "upgrade",
              CHILD_RECORD: f.record,
            },
          });
        },
      }),
  });
  cleanup(t, report);
  assert.equal(report.passed, true, JSON.stringify(report));
  assert.equal(report.agentResult.runtime_home_removed, true);
  assert.equal(fs.existsSync(configuration.env.CODEX_HOME), false);
  assert.deepEqual(
    Object.keys(configuration.env)
      .filter((key) => !["SystemRoot", "WINDIR"].includes(key))
      .sort(),
    ["CODEX_HOME", "PATH"],
  );
  assert.equal(JSON.stringify(report).includes("synthetic-private-key"), false);
  assert.equal(JSON.parse(fs.readFileSync(f.record)).has_provider_key, true);
  await stopped(f.record);
});

test("parent cancellation aborts a cooperative native SDK child and keeps failed observations", async (t) => {
  const f = await fixture(t, "hang"),
    controller = new AbortController();
  let observation;
  const promise = runCodex(f.directory, {
    sdk: f.sdk,
    signal: controller.signal,
    onObservation: (value) => {
      observation = structuredClone(value);
      if (value.events.length >= 3)
        controller.abort(new Error("Controlled parent cancellation"));
    },
  });
  await assert.rejects(promise, /Controlled parent cancellation/);
  assert.equal(observation.completed, false);
  assert.equal(observation.cleanup_requested, true);
  await stopped(f.record);
});

test("recording fault after upgrade stops further verification but preserves failed receipt and actual files", async (t) => {
  const f = await fixture(t, "upgrade");
  let tripped = false;
  const report = await runMaintenance({
    outputRoot: f.directory,
    agent: (workspace, options) =>
      runCodex(workspace, { ...options, sdk: f.sdk }),
    writer: (file, value) => {
      if (
        !tripped &&
        value.agentResult?.events.some(
          (event) => event.item?.type === "file_change",
        )
      ) {
        tripped = true;
        throw new Error("Controlled recording fault");
      }
      saveReport(file, value);
    },
  });
  cleanup(t, report);
  assert.equal(report.passed, false);
  assert.match(report.evidenceError, /Controlled recording fault/);
  assert.equal(report.verification, null);
  assert.equal(JSON.parse(fs.readFileSync(report.reportPath)).status, "failed");
  const verification = await verifyWorkspace(report.workspace, report.baseline);
  if (verification.checkDir)
    t.after(() =>
      fs.rmSync(verification.checkDir, { recursive: true, force: true }),
    );
  assert.equal(verification.passed, true);
  await stopped(f.record);
});

test("initial recording fault dispatches no agent and publishes a failed preflight if storage recovers", async (t) => {
  const f = await fixture(t, "upgrade");
  let called = false,
    first = true;
  const report = await runMaintenance({
    outputRoot: f.directory,
    agent: async () => {
      called = true;
    },
    writer: (file, value) => {
      if (first) {
        first = false;
        throw new Error("Initial recording unavailable");
      }
      saveReport(file, value);
    },
  });
  assert.equal(called, false);
  assert.equal(report.workspace, null);
  assert.equal(report.passed, false);
  assert.equal(JSON.parse(fs.readFileSync(report.reportPath)).status, "failed");
  assert.equal(fs.existsSync(f.record), false);
});

test("a caller agent with an upgrade but no explicit completed result cannot pass", async (t) => {
  const { upgrade } = await import("./helpers/upgrade.js"),
    f = await fixture(t, "unused");
  const report = await runMaintenance({
    outputRoot: f.directory,
    agent: async (workspace) => {
      upgrade(workspace);
      return { finalResponse: "Unfinished caller report" };
    },
  });
  cleanup(t, report);
  assert.equal(report.passed, false);
  assert.match(report.agentError, /completed nonblank output/);
  assert.equal(report.verification.passed, true);
  assert.equal(report.agent_kind, "caller_injected_agent");
});

test("persistent final recording failure throws with failed in-memory evidence and unknown durable state", async (t) => {
  const f = await fixture(t, "unused");
  await assert.rejects(
    runMaintenance({
      outputRoot: f.directory,
      writer: () => {
        throw new Error("Persistent recorder fault");
      },
    }),
    (error) => {
      assert.equal(error.report.passed, false);
      assert.equal(error.report.status, "failed");
      assert.equal(error.report.last_durable_receipt_status, "unknown");
      assert.equal(error.report.workspace, null);
      return true;
    },
  );
});
