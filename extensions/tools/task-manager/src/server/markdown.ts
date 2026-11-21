import { marked } from "marked";
import DOMPurify from "isomorphic-dompurify";

/**
 * Render markdown to sanitized HTML.
 * - Uses `marked` to convert markdown to HTML.
 * - Uses `isomorphic-dompurify` (works in Node, no DOM required) to strip XSS.
 * - Synchronous: marked.parse returns string when async: false.
 *
 * Per spec §2.6, the dashboard renders the full task file (frontmatter + body).
 * YAML frontmatter (a leading `---` ... `---` block) is rendered as a fenced
 * code block so it appears as `<pre><code>` rather than being misinterpreted by
 * marked as headings / horizontal rules.
 */
export function renderMarkdown(md: string): string {
    const processed = wrapFrontmatterAsCodeBlock(md);
    const raw = marked.parse(processed, { async: false }) as string;
    return DOMPurify.sanitize(raw);
}

/**
 * If `md` starts with a YAML frontmatter block (`---` ... `---` at the very top),
 * wrap that block in a fenced code block so marked renders it as `<pre><code>`.
 * The rest of the document is returned unchanged.
 */
function wrapFrontmatterAsCodeBlock(md: string): string {
    // Match a leading `---` line, any body, a closing `---` line, then end-of-line.
    const match = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!match) return md;
    const frontmatterBody = match[1];
    const rest = md.slice(match[0].length);
    const fenced = "```yaml\n" + frontmatterBody + "\n```\n";
    return fenced + rest;
}