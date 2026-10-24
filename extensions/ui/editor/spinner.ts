/**
 * Dot animation for the loading widget above the editor. Frames are rendered
 * verbatim (they are colored by the caller), so each is just the raw dot
 * pattern.
 */
export const SPINNER_FRAMES: readonly string[] = [
    ".  ",
    ".. ",
    "...",
    " ..",
    "  .",
    "   "
];

export const SPINNER_INTERVAL_MS = 80;
