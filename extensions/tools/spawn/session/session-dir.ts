import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

export function deriveSpawnSessionDir(
  parentSessionFile: string | undefined,
  cwd: string,
): string {
  if (parentSessionFile) {
    const dir = dirname(parentSessionFile);
    const base = basename(parentSessionFile, ".jsonl");
    return join(dir, base, "tasks");
  }

  const encoded = cwd.replace(/[/\\]/g, "-").replace(/^[A-Za-z]:-/, "").replace(/^-+/, "");
  const root = join(tmpdir(), `pi-spawn-${process.getuid?.() ?? 0}`);
  return join(root, encoded, "tasks");
}
