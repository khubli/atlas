import { execFileSync } from "node:child_process";

export default function globalSetup() {
  const args = ["scripts/make-fixtures.mjs", "tests/e2e/.fixtures"];
  if (process.env.ATLAS_SCALE) args.push("--scale");
  execFileSync(process.execPath, args, { stdio: "inherit" });
}
