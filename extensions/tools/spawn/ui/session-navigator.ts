import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  type Keybinding,
  type KeyId,
  type MarkdownTheme,
  matchesKey,
  type OverlayOptions,
  type TUI,
  type TuiMode,
  type TuiMouseEvent,
  type TuiMouseEventResult,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import type { AgentConfigLookup } from "../config/agent-types.ts";
import { readPersistedRuns, type SessionEntryLike } from "../persisted-record.ts";
import { formatModel, type ModelIdentity, type Theme } from "./display.ts";
import { labeledRule } from "../../../../shared/labeled-rule.ts";
import { probeTuiMode } from "../../../../shared/tui-mode.ts";
import {
  type EntryHeading,
  fileSnapshotSource,
  listNavigableAgents,
  liveSource,
  type NavigableSpawn,
  type TranscriptSource,
} from "./session-navigation.ts";
import { TranscriptContent } from "./transcript-content.ts";

const CHROME_LINES = 2;
const MIN_VIEWPORT = 3;
const VIEWPORT_HEIGHT_PCT = 70;

const PI_FOOTER_ROWS = 2;

const FULLSCREEN_OVERLAY: OverlayOptions = {
  anchor: "bottom-center",
  width: "100%",
  maxHeight: `${VIEWPORT_HEIGHT_PCT}%`,
  margin: { bottom: PI_FOOTER_ROWS },
};

export type TranscriptTheme = Theme & {

  getThinkingBorderColor(level: string): (text: string) => string;
};

export interface PaneKeys {
  matches(data: string, keybinding: Keybinding): boolean;
  getKeys(keybinding: Keybinding): KeyId[];
}

export type CustomComponentFactory<R> = (
  tui: TUI,
  theme: TranscriptTheme,
  keybindings: PaneKeys,
  done: (result: R) => void,
) => Component;

export interface SessionNavigatorUI {
  select(title: string, options: string[]): Promise<string | undefined>;
  notify(message: string, level: "info" | "warning" | "error"): void;
  custom<R>(component: CustomComponentFactory<R>, options?: ViewerMountOptions): Promise<R>;
}

export interface ViewerMountOptions {
  overlay: boolean;
  overlayOptions?: OverlayOptions;
}

export interface SessionNavigatorParams {
  ui: SessionNavigatorUI;
  agents: readonly NavigableSpawn[];
  registry: AgentConfigLookup;

  cwd: string;

  readFile: (path: string) => string;

  sessionEntries: readonly SessionEntryLike[];
}

interface ScrollOptions {
  follow?: boolean;
}

export interface TranscriptPaneOptions {
  tui: TUI;
  theme: TranscriptTheme;

  keys: PaneKeys;
  source: TranscriptSource;

  heading: EntryHeading;
  done: (result: undefined) => void;
  cwd: string;
  markdownTheme: MarkdownTheme;
}

export class SessionNavigatorHandler {
  async handle({ ui, agents, registry, cwd, readFile, sessionEntries }: SessionNavigatorParams): Promise<void> {
    const entries = listNavigableAgents(agents, registry, readPersistedRuns(sessionEntries));
    if (entries.length === 0) {
      ui.notify("No spawn sessions to view.", "info");
      return;
    }

    const choice = await ui.select(
      "Spawn sessions",
      entries.map((entry) => entry.label),
    );
    const entry = entries.find((candidate) => candidate.label === choice);
    if (!entry) return;

    let source: TranscriptSource;
    try {
      source = entry.kind === "live" ? liveSource(entry.record) : fileSnapshotSource(entry.outputFile, readFile);
    } catch {
      ui.notify("Could not read the session transcript file.", "error");
      return;
    }
    const markdownTheme = getMarkdownTheme();
    const mode = await probeTuiMode(ui);
    await ui.custom<undefined>(
      (tui, theme, keys, done) =>
        new TranscriptPane({ tui, theme, keys, source, heading: entry.heading, done, cwd, markdownTheme }),
      viewerMountOptions(mode),
    );
  }
}

function viewerMountOptions(mode: TuiMode): ViewerMountOptions {
  return mode === "fullscreen" ? { overlay: true, overlayOptions: FULLSCREEN_OVERLAY } : { overlay: false };
}

export class TranscriptPane implements Component {
  private scrollOffset = 0;
  private autoScroll = true;
  private unsubscribe: (() => void) | undefined;
  private closed = false;

  private readonly tui: TUI;
  private readonly theme: TranscriptTheme;
  private readonly keys: PaneKeys;
  private readonly source: TranscriptSource;
  private readonly heading: EntryHeading;
  private readonly done: (result: undefined) => void;
  private readonly content: TranscriptContent;

  private renderedWidth: number | undefined;

  constructor({ tui, theme, keys, source, heading, done, cwd, markdownTheme }: TranscriptPaneOptions) {
    this.tui = tui;
    this.theme = theme;
    this.keys = keys;
    this.source = source;
    this.heading = heading;
    this.done = done;
    this.content = new TranscriptContent({ tui, cwd, markdownTheme, source });
    this.unsubscribe = source.subscribe((event) => {
      if (this.closed) return;
      this.content.apply(event);
      this.tui.requestRender();
    });
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "q")) {
      this.closed = true;
      this.done(undefined);
      return;
    }

    const { viewportHeight } = this.scrollBounds(this.inputWidth());

    if (matchesKey(data, "up") || matchesKey(data, "k")) {
      this.scrollBy(-1);
    } else if (matchesKey(data, "down") || matchesKey(data, "j")) {
      this.scrollBy(1);
    } else if (this.keys.matches(data, "tui.altScreen.pageUp") || matchesKey(data, "shift+up")) {
      this.scrollBy(-viewportHeight, { follow: false });
    } else if (this.keys.matches(data, "tui.altScreen.pageDown") || matchesKey(data, "shift+down")) {
      this.scrollBy(viewportHeight);
    } else if (this.keys.matches(data, "tui.altScreen.top")) {
      this.scrollTo(0, { follow: false });
    } else if (this.keys.matches(data, "tui.altScreen.bottom")) {
      this.scrollTo(Number.POSITIVE_INFINITY);
    }
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type !== "wheel") return undefined;
    this.scrollBy(event.wheelDelta ?? 0);
    return { handled: true };
  }

  render(width: number): string[] {
    if (width < 6) return [];
    const th = this.theme;
    this.renderedWidth = width;
    const lines: string[] = [];

    const fit = (content: string): string => truncateToWidth(content, width);
    const { model, thinkingLevel } = this.source.sessionModel();
    const paint = th.getThinkingBorderColor(thinkingLevel ?? "off");

    lines.push(labeledRule(width, paint, this.headerLabels(model, thinkingLevel)));

    const { totalLines, viewportHeight, maxScroll } = this.scrollBounds(width);
    if (this.autoScroll) this.scrollOffset = maxScroll;
    const visibleStart = Math.min(this.scrollOffset, maxScroll);
    const visible = this.content.slice(width, visibleStart, viewportHeight);
    for (let i = 0; i < viewportHeight; i++) lines.push(fit(visible[i] ?? ""));

    const scrollPct =
      totalLines <= viewportHeight
        ? "100%"
        : `${Math.round(((visibleStart + viewportHeight) / totalLines) * 100)}%`;
    const position = th.fg("dim", `${totalLines} lines · ${scrollPct}`);
    const hints = th.fg("dim", this.footerHint());
    lines.push(labeledRule(width, paint, [position], [hints]));

    return lines;
  }

  invalidate(): void {
    this.content.invalidate();
  }

  dispose(): void {
    this.closed = true;
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
  }

  private footerHint(): string {
    const page = this.keyPair("tui.altScreen.pageUp", "tui.altScreen.pageDown");
    const ends = this.keyPair("tui.altScreen.top", "tui.altScreen.bottom");
    return ["↑↓ scroll", page, ends, "Esc close"].filter((segment) => segment !== "").join(" · ");
  }

  private keyPair(first: Keybinding, second: Keybinding): string {
    return [first, second]
      .flatMap((keybinding) => this.keys.getKeys(keybinding).slice(0, 1))
      .map(displayKey)
      .join("/");
  }

  private headerLabels(model: ModelIdentity | undefined, thinkingLevel: string | undefined): string[] {
    const th = this.theme;
    const { name, modeLabel, description } = this.heading;
    const identity = th.bold(name) + (modeLabel ? ` ${th.fg("muted", `(${modeLabel})`)}` : "");
    const runtime = describeRuntime(model, thinkingLevel);
    const runtimeTag = runtime ? th.fg("muted", ` · ${runtime}`) : "";
    return [`${identity}  ${th.fg("muted", description)}${runtimeTag}`, identity + runtimeTag, identity];
  }

  private scrollBy(delta: number, options?: ScrollOptions): void {
    this.scrollTo(this.scrollOffset + delta, options);
  }

  private scrollTo(offset: number, { follow }: ScrollOptions = {}): void {
    const { maxScroll } = this.scrollBounds(this.inputWidth());
    this.scrollOffset = Math.min(maxScroll, Math.max(0, offset));
    this.autoScroll = follow ?? this.scrollOffset >= maxScroll;
  }

  private scrollBounds(width: number): { totalLines: number; viewportHeight: number; maxScroll: number } {
    const totalLines = this.content.lineCount(width);
    const viewportHeight = this.viewportHeight(totalLines);
    return { totalLines, viewportHeight, maxScroll: Math.max(0, totalLines - viewportHeight) };
  }

  private inputWidth(): number {
    return this.renderedWidth ?? this.tui.terminal.columns;
  }

  private viewportHeight(totalLines: number): number {
    const cap = Math.floor((this.tui.terminal.rows * VIEWPORT_HEIGHT_PCT) / 100) - CHROME_LINES;
    return Math.max(MIN_VIEWPORT, Math.min(totalLines, cap));
  }
}

function displayKey(key: KeyId): string {
  return key
    .split("+")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("+");
}

function describeRuntime(model: ModelIdentity | undefined, thinkingLevel: string | undefined): string {
  if (!model) return thinkingLevel ? `thinking ${thinkingLevel}` : "";
  if (!thinkingLevel) return formatModel(model);
  const level = thinkingLevel === "off" ? "thinking off" : thinkingLevel;
  return `${formatModel(model)} • ${level}`;
}
