import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { LspClient } from "../client.js";
import path from "path";

async function main() {
  // Test on tiangolo's template
  const dir = "/tmp/full-stack-fastapi-template/backend";
  const file = path.join(dir, "app/api/routes/users.py");

  const proc = spawn("pyright-langserver", ["--stdio"], {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: dir,
    env: { ...process.env, PYTHONPATH: dir, VIRTUAL_ENV: `${dir}/.venv` },
  });

  const client = new LspClient(proc);
  await client.initialize(dir);
  await client.openFile(file, "python");
  await new Promise(r => setTimeout(r, 5000));

  // users.py line 37: def read_users(session: SessionDep, skip: int = 0, limit: int = 100) -> Any:
  // SessionDep is Annotated[Session, Depends(get_db)]
  // Check hover on "SessionDep" parameter type
  console.log("--- Hover on parameter types ---");

  // Also check sLEGACY
  const slegacyDir = "/home/dil83671/projects/sLEGACY/backend";
  const slegacyFile = path.join(slegacyDir, "app/api/rolls.py");

  const proc2 = spawn("pyright-langserver", ["--stdio"], {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: slegacyDir,
    env: { ...process.env, PYTHONPATH: slegacyDir, VIRTUAL_ENV: `${slegacyDir}/.venv` },
  });

  const client2 = new LspClient(proc2);
  await client2.initialize(slegacyDir);
  await client2.openFile(slegacyFile, "python");
  await new Promise(r => setTimeout(r, 5000));

  // rolls.py: get_current_user_id parameter — try definition on the Depends() call
  // Line 27 (0-indexed): _user_id: UUID = Depends(get_current_user_id),
  // "get_current_user_id" starts at col ~37
  const def = await client2.definition(slegacyFile, 26, 37);
  console.log("sLEGACY Depends(get_current_user_id) definition:",
    def ? def.map(d => `${d.uri.split("/").pop()}:${d.range.start.line}`).join(", ") : "null"
  );

  // Also test: decorator dependencies=[Depends(X)] pattern from tiangolo
  // users.py line 34 (0-indexed): dependencies=[Depends(get_current_active_superuser)],
  const tiangoloDef = await client.definition(file, 33, 37);
  console.log("tiangolo dependencies=[Depends(get_current_active_superuser)]:",
    tiangoloDef ? tiangoloDef.map(d => `${d.uri.split("/").pop()}:${d.range.start.line}`).join(", ") : "null"
  );

  await client.shutdown();
  await client2.shutdown();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
