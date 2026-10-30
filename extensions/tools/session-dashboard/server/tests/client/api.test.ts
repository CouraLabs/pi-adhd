// @vitest-environment happy-dom
// tests/client/api.test.ts
// Exercises the frontend api.ts wrappers against a mocked fetch.

import { describe, it, expect, vi, afterEach } from "vitest";
import { ApiError, listSessions, getSession, listChildren } from "../../src/api";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetchOnce(body: unknown, status = 200): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("api.ts", () => {
  it("listSessions() returns parsed array", async () => {
    mockFetchOnce([{ id: "a", cwd: "/x", name: null }]);
    const list = await listSessions();
    expect(list).toEqual([{ id: "a", cwd: "/x", name: null }]);
  });

  it("getSession() returns parsed detail", async () => {
    mockFetchOnce({
      header: { id: "a", version: 3, timestamp: "t", cwd: "/x" },
      branch: [],
      totalEntries: 0,
    });
    const d = await getSession("a");
    expect(d.header.id).toBe("a");
    expect(d.branch).toEqual([]);
  });

  it("listChildren() returns the children array from the wrapper response", async () => {
    mockFetchOnce({ parent: "p", children: ["c1", "c2"] });
    const children = await listChildren("p");
    expect(children).toEqual(["c1", "c2"]);
  });

  it("listChildren() returns [] for parent with no children", async () => {
    mockFetchOnce({ parent: "solo", children: [] });
    const children = await listChildren("solo");
    expect(children).toEqual([]);
  });

  it("listChildren() throws ApiError on 404", async () => {
    mockFetchOnce({ error: "session not found" }, 404);
    await expect(listChildren("missing")).rejects.toBeInstanceOf(ApiError);
  });

  it("fetch error surfaces as ApiError with parsed body when present", async () => {
    mockFetchOnce({ error: "bad things" }, 500);
    await expect(listSessions()).rejects.toMatchObject({
      name: "ApiError",
      status: 500,
    });
  });
});
