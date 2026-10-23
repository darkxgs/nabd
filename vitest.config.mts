import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: { alias: { "@": r("./src"), "server-only": r("./test/server-only-stub.ts") } },
  test: { environment: "node", include: ["src/**/*.test.ts", "test/**/*.test.ts"], testTimeout: 60_000 },
});
