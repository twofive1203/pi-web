process.env.PI_WEB_AGENT_RUNTIME = "omp";
process.env.PI_WEB_SESSIOND_PORT ??= "8704";
await import("../src/server/sessiond.ts");
