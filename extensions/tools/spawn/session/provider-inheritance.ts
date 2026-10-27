export interface RegisteredProviderSource<TNative, TConfig> {
  getRegisteredProviderIds(): readonly string[];
  getRegisteredNativeProvider(id: string): TNative | undefined;
  getRegisteredProviderConfig(id: string): TConfig | undefined;
}

export interface ProviderRegistrar<TNative, TConfig> {
  registerNative(provider: TNative): void;
  registerConfigured(id: string, config: TConfig): void;
}

export function inheritRegisteredProviders<TNative, TConfig>(
  source: RegisteredProviderSource<TNative, TConfig>,
  target: ProviderRegistrar<TNative, TConfig>,
): void {
  for (const id of source.getRegisteredProviderIds()) {
    const native = source.getRegisteredNativeProvider(id);
    if (native !== undefined) {
      target.registerNative(native);
      continue;
    }
    const config = source.getRegisteredProviderConfig(id);
    if (config !== undefined) target.registerConfigured(id, config);
  }
}
