export interface SettingsToast {
  message: string;
  level: "info" | "warning";
}

export interface SpawnSettingsManager {
  readonly defaultMaxTurns: number | undefined;
  readonly wrapUpTurns: number;
  readonly consumedSessionRetentionMinutes: number;
  readonly unconsumedSessionRetentionMinutes: number;
  applyDefaultMaxTurns(n: number): SettingsToast;
  applyWrapUpTurns(n: number): SettingsToast;
  applyConsumedSessionRetentionMinutes(n: number): SettingsToast;
  applyUnconsumedSessionRetentionMinutes(n: number): SettingsToast;
}

export interface SpawnSettingsUI {
  select(title: string, options: string[]): Promise<string | undefined>;
  input(title: string, defaultValue?: string): Promise<string | undefined>;
  notify(message: string, level: "info" | "warning" | "error"): void;
}

interface SettingDescriptorBase {

  label: string;

  currentDisplay: (settings: SpawnSettingsManager) => string | number;
}

interface NumericSettingDescriptor extends SettingDescriptorBase {
  kind: "numeric";

  inputTitle: string;

  inputDefault: (settings: SpawnSettingsManager) => string;

  minimum: number;

  validationMessage: string;

  apply: (settings: SpawnSettingsManager, n: number) => SettingsToast;
}

type SettingDescriptor = NumericSettingDescriptor;

const SETTINGS: readonly SettingDescriptor[] = [
  {
    kind: "numeric",
    label: "Default max turns",
    currentDisplay: (settings) => settings.defaultMaxTurns ?? "unlimited",
    inputTitle: "Default max turns before wrap-up (0 = unlimited)",
    inputDefault: (settings) => String(settings.defaultMaxTurns ?? 0),
    minimum: 0,
    validationMessage: "Must be 0 (unlimited) or a positive integer.",
    apply: (settings, n) => settings.applyDefaultMaxTurns(n),
  },
  {
    kind: "numeric",
    label: "Wrap-up turns",
    currentDisplay: (settings) => settings.wrapUpTurns,
    inputTitle: "Turns left when a spawn is warned to wrap up",
    inputDefault: (settings) => String(settings.wrapUpTurns),
    minimum: 1,
    validationMessage: "Must be a positive integer.",
    apply: (settings, n) => settings.applyWrapUpTurns(n),
  },
  {
    kind: "numeric",
    label: "Consumed-session retention",
    currentDisplay: (settings) => `${settings.consumedSessionRetentionMinutes} min`,
    inputTitle: "Minutes to retain a consumed agent's session",
    inputDefault: (settings) => String(settings.consumedSessionRetentionMinutes),
    minimum: 1,
    validationMessage: "Must be a positive integer.",
    apply: (settings, n) => settings.applyConsumedSessionRetentionMinutes(n),
  },
  {
    kind: "numeric",
    label: "Unconsumed-session retention",
    currentDisplay: (settings) => `${settings.unconsumedSessionRetentionMinutes} min`,
    inputTitle: "Minutes to retain an unconsumed agent's session (safety cap)",
    inputDefault: (settings) => String(settings.unconsumedSessionRetentionMinutes),
    minimum: 1,
    validationMessage: "Must be a positive integer.",
    apply: (settings, n) => settings.applyUnconsumedSessionRetentionMinutes(n),
  },
];

export class SpawnSettingsHandler {
  constructor(private readonly settings: SpawnSettingsManager) {}

  async handle({ ui }: { ui: SpawnSettingsUI }): Promise<void> {
    const options = SETTINGS.map(
      (d) => `${d.label} (current: ${d.currentDisplay(this.settings)})`,
    );
    const choice = await ui.select("Settings", options);
    if (!choice) return;

    const descriptor = SETTINGS.find((d) => choice.startsWith(d.label));
    if (!descriptor) return;

    if (descriptor.kind === "numeric") {
      await this.promptNumeric(ui, descriptor);
      return;
    }
  }

  private async promptNumeric(
    ui: SpawnSettingsUI,
    descriptor: NumericSettingDescriptor,
  ): Promise<void> {
    const val = await ui.input(descriptor.inputTitle, descriptor.inputDefault(this.settings));
    if (!val) return;

    const n = parseInt(val, 10);
    if (n >= descriptor.minimum) {
      const toast = descriptor.apply(this.settings, n);
      ui.notify(toast.message, toast.level);
    } else {
      ui.notify(descriptor.validationMessage, "warning");
    }
  }
}
