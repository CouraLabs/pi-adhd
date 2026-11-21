import { resolve } from "node:path";

/** Root directory holding all workspace task trees (~/.pi/tasks). */
export const TASKS_ROOT = resolve(
    process.env.HOME || process.env.USERPROFILE || "",
    ".pi",
    "tasks",
);

/**
 * Get workspace name from cwd (e.g., "C:/temp" -> "C-temp").
 *
 * Normalizes the path, then replaces drive-letter colons and path separators
 * with dashes, finally stripping leading/trailing dashes.
 */
export function getWorkspaceName(cwd: string): string {
    // Normalize path: remove duplicate slashes, trailing slashes
    const normalized = cwd.replace(/\\+/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
    // Replace drive letter colon and path separators with dashes
    return normalized.replace(/[:\/]/g, "-").replace(/^-+|-+$/g, "");
}