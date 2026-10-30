// tests/server/pathEncoding.test.ts
import { describe, it, expect } from "vitest";
import { cwdToDirName, dirNameToCwd } from "../../server";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

describe("path encoding", () => {
  it("encodes /Users/foo/bar", () => {
    expect(cwdToDirName("/Users/foo/bar")).toBe("--Users-foo-bar--");
  });

  it("decodes --Users-foo-bar--", () => {
    expect(dirNameToCwd("--Users-foo-bar--")).toBe("/Users/foo/bar");
  });

  it("handles root /", () => {
    expect(cwdToDirName("/")).toBe("--");
    expect(dirNameToCwd("--")).toBe("/");
  });

  it("handles /tmp", () => {
    expect(cwdToDirName("/tmp")).toBe("--tmp--");
    expect(dirNameToCwd("--tmp--")).toBe("/tmp");
  });

  it("handles single segment /Users/daniel", () => {
    expect(cwdToDirName("/Users/daniel")).toBe("--Users-daniel--");
    expect(dirNameToCwd("--Users-daniel--")).toBe("/Users/daniel");
  });

  it("handles trailing slash", () => {
    expect(cwdToDirName("/foo/bar/")).toBe("--foo-bar--");
    expect(dirNameToCwd("--foo-bar--")).toBe("/foo/bar");
  });

  it("round-trips common paths", () => {
    const paths = [
      "/",
      "/tmp",
      "/Users",
      "/Users/daniel",
      "/Users/daniel/repo",
      "/var/log",
      "/a/b/c/d/e",
    ];
    for (const p of paths) {
      expect(dirNameToCwd(cwdToDirName(p))).toBe(p);
    }
  });

  it("round-trips real session directory names from ~/.pi/agent/sessions/", () => {
    const sessionsRoot = join(homedir(), ".pi/agent/sessions");
    let names: string[] = [];
    try {
      names = readdirSync(sessionsRoot);
    } catch {
      // Skip if sessions dir doesn't exist in this environment.
      return;
    }
    expect(names.length).toBeGreaterThan(0);
    let tested = 0;
    for (const name of names) {
      // All entries here are directories (or subdirs); skip files if any.
      const decoded = dirNameToCwd(name);
      // The encoding/decoding must be a stable inverse.
      expect(cwdToDirName(decoded)).toBe(name);
      // Decoded form must start with /.
      expect(decoded.startsWith("/")).toBe(true);
      tested++;
      if (tested >= 20) break;
    }
    expect(tested).toBeGreaterThan(0);
  });
});
