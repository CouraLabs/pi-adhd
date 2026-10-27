import type { SessionContext } from "../types.ts";

export interface LifecycleManager {
  clearCompleted(): Promise<void>;
  abortAllAndSettle(): Promise<number>;
  dispose(): Promise<void>;
}

export interface LifecycleRuntime {
  setSessionContext(ctx: SessionContext): void;
  clearSessionContext(): void;
}

export class SessionLifecycleHandler {
  constructor(
    private readonly runtime: LifecycleRuntime,
    private readonly manager: LifecycleManager,
    private readonly unpublishService: () => void,
  ) {}

  handleSessionStart(_event: unknown, ctx: unknown): Promise<void> {
    this.runtime.setSessionContext(ctx as SessionContext);
    return this.manager.clearCompleted();
  }

  handleSessionBeforeSwitch(): Promise<void> {
    return this.manager.clearCompleted();
  }

  async handleSessionShutdown(): Promise<void> {
    this.unpublishService();
    this.runtime.clearSessionContext();
    await this.manager.abortAllAndSettle();
    await this.manager.dispose();
  }
}
