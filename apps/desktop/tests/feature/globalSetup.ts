import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export default async function globalSetup() {
  await execFileAsync("node", ["scripts/generate-test-fixtures.mjs"], {
    windowsHide: true,
  });
}
