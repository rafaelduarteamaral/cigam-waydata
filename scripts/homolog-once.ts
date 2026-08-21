/**
 * One-shot controlado de homologação.
 * Não altera o .env permanente: use variáveis no comando.
 *
 * Exemplo:
 *   ENV_FILE=./.env SYNC_MODE=write SYNC_ONCE=true SYNC_ROUTE_IDS=36858 SYNC_MAX_ROUTES=1 \
 *     tsx scripts/homolog-once.ts
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerEntry = path.join(root, "apps/worker/src/main.ts");

const env = {
  ...process.env,
  ENV_FILE: process.env.ENV_FILE ?? path.join(root, ".env"),
  SYNC_MODE: process.env.SYNC_MODE ?? "write",
  SYNC_ONCE: "true",
  SYNC_ENABLED: "true",
  SYNC_ROUTE_IDS: process.env.SYNC_ROUTE_IDS ?? "36858",
  SYNC_MAX_ROUTES: process.env.SYNC_MAX_ROUTES ?? "1",
};

console.log(JSON.stringify({
  mode: "homolog-once",
  routeIds: env.SYNC_ROUTE_IDS,
  maxRoutes: env.SYNC_MAX_ROUTES,
  syncMode: env.SYNC_MODE,
  note: "Escrita limitada à allowlist. O .env permanente não é alterado por este script.",
}));

const tsxBin = path.join(root, "node_modules/.bin/tsx");
const child = spawn(tsxBin, [workerEntry], {
  cwd: path.join(root, "apps/worker"),
  env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Worker interrompido por sinal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
