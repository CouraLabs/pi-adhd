// tests/server/parseSessionHeader.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSessionHeader } from "../../server";
import { makeSession } from "../helpers/makeSession";

describe("parseSessionHeader", () => {
  it("reads the first line of a real session file", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "sdb-header-"));
    const { filepath } = makeSession(tmp, { messages: [{ role: "user", content: "hi" }] });
    const h = await parseSessionHeader(filepath);
    expect(h.type).toBe("session");
    expect(typeof h.id).toBe("string");
    expect(h.id.length).toBe(36);
    expect(h.cwd).toBe("/Users/test/project");
    expect(typeof h.timestamp).toBe("string");
    expect(typeof h.version).toBe("number");
  });

  it("throws on an empty file", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "sdb-header-"));
    const f = join(tmp, "empty.jsonl");
    writeFileSync(f, "");
    await expect(parseSessionHeader(f)).rejects.toThrow();
  });

  it("throws on a file whose first line is not a session header", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "sdb-header-"));
    const f = join(tmp, "wrong.jsonl");
    writeFileSync(
      f,
      JSON.stringify({ type: "message", id: "01020304", parentId: null }) + "\n",
    );
    await expect(parseSessionHeader(f)).rejects.toThrow(/session header/);
  });
});
