import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts/annotate_metrics_pgn.ts");
const result = spawnSync(
  "npx",
  ["--yes", "tsx", script],
  {
    cwd: join(root, "mobile"),
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_PATH: join(root, "mobile/node_modules"),
    },
  }
);
process.exit(result.status ?? 1);
