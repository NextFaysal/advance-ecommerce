/**
 * Hook + adapter registries — Agent 17, Step 49 (A13).
 *
 * In-memory registries. Core registers its built-in adapters at boot;
 * plugins register hook subscriptions and (optionally) extra adapters.
 * Dispatch is sequential by priority so ordering is deterministic; a
 * failing hook is recorded and NEVER blocks the core operation or the
 * remaining hooks — the domain operation already succeeded by the time
 * hooks run (same contract as the automation engine's effects).
 */
import type {
  AdapterKind,
  AdapterRegistration,
  DomainEvent,
  HookEventPayload,
  HookHandler,
  HookHandlerResult,
  HookSubscription,
} from "./types";

export interface HookDispatchEntry {
  subscriptionId: string;
  pluginId: string;
  result: HookHandlerResult;
}

export interface HookRegistry {
  subscribe(sub: HookSubscription, handler: HookHandler): void;
  unsubscribe(subscriptionId: string): boolean;
  subscriptionsFor(event: DomainEvent): HookSubscription[];
  dispatch(payload: HookEventPayload): Promise<HookDispatchEntry[]>;
  list(): HookSubscription[];
}

interface RegisteredHook {
  sub: HookSubscription;
  handler: HookHandler;
}

export class InMemoryHookRegistry implements HookRegistry {
  private hooks = new Map<string, RegisteredHook>();

  subscribe(sub: HookSubscription, handler: HookHandler): void {
    if (this.hooks.has(sub.id)) {
      throw new Error(`Duplicate hook subscription id: ${sub.id}`);
    }
    this.hooks.set(sub.id, { sub, handler });
  }

  unsubscribe(subscriptionId: string): boolean {
    return this.hooks.delete(subscriptionId);
  }

  subscriptionsFor(event: DomainEvent): HookSubscription[] {
    return [...this.hooks.values()]
      .map((h) => h.sub)
      .filter((s) => s.event === event && s.isEnabled)
      .sort((a, b) => a.priority - b.priority);
  }

  async dispatch(payload: HookEventPayload): Promise<HookDispatchEntry[]> {
    const entries: HookDispatchEntry[] = [];
    for (const sub of this.subscriptionsFor(payload.event)) {
      const registered = this.hooks.get(sub.id);
      if (!registered) continue;
      try {
        const result = await registered.handler(payload);
        entries.push({ subscriptionId: sub.id, pluginId: sub.pluginId, result });
      } catch (err) {
        entries.push({
          subscriptionId: sub.id,
          pluginId: sub.pluginId,
          result: { ok: false, error: err instanceof Error ? err.message : "hook_failed" },
        });
      }
    }
    return entries;
  }

  list(): HookSubscription[] {
    return [...this.hooks.values()].map((h) => h.sub);
  }
}

/* ------------------------------------------------------------------ */
/* Adapter registry                                                    */
/* ------------------------------------------------------------------ */

export interface AdapterRegistry {
  register(reg: AdapterRegistration): void;
  get(kind: AdapterKind, providerKey: string): AdapterRegistration | null;
  list(kind?: AdapterKind): AdapterRegistration[];
}

export class InMemoryAdapterRegistry implements AdapterRegistry {
  private adapters = new Map<string, AdapterRegistration>();

  private keyOf(kind: AdapterKind, providerKey: string): string {
    return `${kind}:${providerKey}`;
  }

  register(reg: AdapterRegistration): void {
    const key = this.keyOf(reg.kind, reg.providerKey);
    if (this.adapters.has(key)) {
      throw new Error(`Adapter already registered: ${key}`);
    }
    this.adapters.set(key, reg);
  }

  get(kind: AdapterKind, providerKey: string): AdapterRegistration | null {
    return this.adapters.get(this.keyOf(kind, providerKey)) ?? null;
  }

  list(kind?: AdapterKind): AdapterRegistration[] {
    const all = [...this.adapters.values()];
    return kind ? all.filter((a) => a.kind === kind) : all;
  }
}

/** Shared demo instances (a DB-backed boot step replaces the contents). */
export const demoHookRegistry: HookRegistry = new InMemoryHookRegistry();
export const demoAdapterRegistry: AdapterRegistry = new InMemoryAdapterRegistry();
