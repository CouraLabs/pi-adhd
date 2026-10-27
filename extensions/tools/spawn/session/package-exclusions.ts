import type { PackageSource, SettingsManager } from "@earendil-works/pi-coding-agent";

type PiSettings = ReturnType<SettingsManager["getGlobalSettings"]>;

type PiSettingsStorage = Parameters<typeof SettingsManager.fromStorage>[0];

export interface ParentSettingsView {
  getGlobalSettings(): PiSettings;
  getProjectSettings(): PiSettings;
}

export function createExcludedPackagesStorage(
  parent: ParentSettingsView,
  excluded: ReadonlySet<string>,
): PiSettingsStorage {
  return {
    withLock(scope, fn) {
      const settings = scope === "global" ? parent.getGlobalSettings() : parent.getProjectSettings();
      fn(JSON.stringify(withPackageExtensionsDisabled(settings, excluded)));
    },
  };
}

export function withPackageExtensionsDisabled(
  settings: PiSettings,
  excluded: ReadonlySet<string>,
): PiSettings {
  if (!settings.packages || excluded.size === 0) return settings;
  return {
    ...settings,
    packages: settings.packages.map((pkg) => disableExtensionsIfExcluded(pkg, excluded)),
  };
}

function disableExtensionsIfExcluded(
  pkg: PackageSource,
  excluded: ReadonlySet<string>,
): PackageSource {
  const source = typeof pkg === "string" ? pkg : pkg.source;
  if (!excluded.has(source)) return pkg;
  return typeof pkg === "string" ? { source, extensions: [] } : { ...pkg, extensions: [] };
}
