/**
 * Parse YAML-ish frontmatter from a markdown task file.
 *
 * Recognized fields: id, title, priority, created, tags.
 * Tags are parsed as a YAML-style list:
 *   tags:
 *     - foo
 *     - bar
 * (and also the inline `tags: [foo, bar]` form for robustness).
 */
export interface Frontmatter {
    id: string;
    title: string;
    priority: string;
    created: string;
    tags: string[];
}

export function parseFrontmatter(content: string): Frontmatter {
    const result: Frontmatter = {
        id: "",
        title: "Untitled",
        priority: "medium",
        created: "",
        tags: [],
    };

    // Remove UTF-8 BOM if present (some older files have it)
    const cleanContent = content.replace(/^\uFEFF/, "");
    const match = cleanContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return result;

    const fm = match[1];

    const titleMatch = fm.match(/title:\s*(.+)/);
    if (titleMatch) result.title = titleMatch[1].trim();

    const priorityMatch = fm.match(/priority:\s*(.+)/);
    if (priorityMatch) result.priority = priorityMatch[1].trim();

    const createdMatch = fm.match(/created:\s*(.+)/);
    if (createdMatch) result.created = createdMatch[1].trim();

    const idMatch = fm.match(/id:\s*(.+)/);
    if (idMatch) result.id = idMatch[1].trim();

    // Tags: support `tags: [a, b]` inline form, or block-list form:
    //   tags:
    //     - a
    //     - b
    const tagsInline = fm.match(/tags:\s*\[([^\]]*)\]/);
    if (tagsInline) {
        result.tags = tagsInline[1]
            .split(",")
            .map(t => t.trim())
            .filter(Boolean);
    } else {
        const tagsBlock = fm.match(/tags:\s*\n((?:\s*-\s*.+\n?)+)/);
        if (tagsBlock) {
            result.tags = tagsBlock[1]
                .split(/\n/)
                .map(line => line.match(/^\s*-\s*(.+)/)?.[1]?.trim() ?? "")
                .filter(Boolean);
        }
    }

    return result;
}

/**
 * Returns the body content (everything after the closing `---` of the frontmatter block).
 * If there is no frontmatter block, returns the whole content unchanged.
 */
export function parseBody(content: string): string {
    // Remove UTF-8 BOM if present
    const cleanContent = content.replace(/^\uFEFF/, "");
    const match = cleanContent.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    if (!match) return content;
    return cleanContent.slice(match[0].length);
}