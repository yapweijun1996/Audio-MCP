import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { basename, dirname, join } from "node:path";

const rename = fs.rename;
fs.rename = async (from, to) => {
  await rename(from, to);
  // Let the test terminate a real server exactly after one asset reaches the workspace.
  if (basename(from) === "master.wav" && dirname(to) === process.env.AUDIO_MCP_WORKSPACE) {
    await fs.writeFile(join(dirname(from), "paused-after-master.tmp"), basename(to));
    await rename(join(dirname(from), "paused-after-master.tmp"), join(dirname(from), "paused-after-master"));
    await new Promise(() => {});
  }
};
syncBuiltinESMExports();
