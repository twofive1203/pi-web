import { spawn } from "node:child_process";

const mode = process.argv[2];
const runtime = process.argv[3] ?? "omp";

if ((mode !== "stack" && mode !== "web") || (runtime !== "omp" && runtime !== "earendil")) {
  throw new Error(`Usage: node scripts/run-dev.mjs <stack|web> <omp|earendil>; received mode=${String(mode)} runtime=${String(runtime)}`);
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const spawnCommand = (script) => process.platform === "win32"
  ? spawn("cmd.exe", ["/d", "/s", "/c", `${npmCommand} run ${script}`], { stdio: "inherit", env: process.env, windowsHide: false })
  : spawn(npmCommand, ["run", script], { stdio: "inherit", env: process.env, windowsHide: false });
const children = [];
let shuttingDown = false;

function devScripts(selectedMode, selectedRuntime) {
  if (selectedMode === "web") {
    return [
      "dev:plugins",
      selectedRuntime === "omp" ? "dev:web:server:omp" : "dev:web:server:earendil",
    ];
  }
  return [
    selectedRuntime === "omp" ? "dev:sessiond:omp" : "dev:sessiond:earendil",
    selectedRuntime === "omp" ? "dev:web:omp" : "dev:web:earendil",
    "dev:client",
  ];
}

function stopOthers(excludedPid) {
  for (const child of children) {
    if (child.pid === undefined || child.pid === excludedPid || child.killed) continue;
    child.kill("SIGTERM");
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  stopOthers();
  process.exitCode = code;
}

for (const script of devScripts(mode, runtime)) {
  const child = spawnCommand(script);
  children.push(child);
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const exitCode = code ?? (signal === undefined ? 0 : 1);
    if (exitCode !== 0) {
      shutdown(exitCode);
      return;
    }
    shutdown(0);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(0));
}
