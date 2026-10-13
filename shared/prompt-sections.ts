/**
 * prompt-sections — system-prompt section tags that more than one extension
 * reads or writes.
 *
 * A section tag is the key an extension writes into
 * `event.systemPromptOptions.sections`. When one extension conditions a
 * section on the active tool set and another extension owns that tool set,
 * both need the same key so the section can be removed regardless of which
 * handler runs first. Keeping the tags here avoids one extension importing
 * another's module just for a string.
 */

/**
 * The todo-upkeep guidance section, written by the `todo` extension whenever
 * `todo` is callable and removed by the `submodes` extension whenever the
 * active submode excludes `todo`.
 */
export const TODO_UPKEEP_SECTION = "todo_upkeep";
