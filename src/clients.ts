// src/clients.ts
import { watch, type FSWatcher } from "node:fs";

export class ClientManager {
  private clients = new Map<string, string>();
  private readonly configPath: string;
  private readonly defaultKey?: string;
  private watcher?: FSWatcher;

  private constructor(configPath: string, defaultKey?: string) {
    this.configPath = configPath;
    this.defaultKey = defaultKey;
  }

  static async create(configPath: string, defaultKey?: string): Promise<ClientManager> {
    const manager = new ClientManager(configPath, defaultKey);
    await manager.loadConfig();
    manager.startWatching();
    return manager;
  }

  private async loadConfig() {
    try {
      const file = Bun.file(this.configPath);
      if (await file.exists()) {
        const data = await file.json();
        
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          throw new Error("Invalid config format: expected an object map");
        }

        const newMap = new Map<string, string>();
        for (const [key, value] of Object.entries(data)) {
            if (typeof key === 'string' && typeof value === 'string') {
                newMap.set(key, value);
            }
        }
        this.clients = newMap;
      } else {
        this.applyFallback();
      }
    } catch (e) {
      console.error(`[ClientManager] Failed to load clients config:`, e);
      // Don't clear existing clients map if parsing fails
      if (this.clients.size === 0) {
        this.applyFallback();
      }
    }
  }

  private applyFallback() {
    const newMap = new Map<string, string>();
    if (this.defaultKey) {
      newMap.set(this.defaultKey, "default-client");
    }
    this.clients = newMap;
  }

  private startWatching() {
    try {
      // Use fs.watch (from Node core) wrapped in try-catch in case path is totally invalid for watching
      this.watcher = watch(this.configPath, { persistent: false }, (event, filename) => {
        if (event === "change") {
          this.loadConfig();
        }
      });
      
      this.watcher.on('error', (err) => {
        console.error('[ClientManager] Watcher error:', err);
      });
    } catch (e) {
      // Ignored for now (e.g. dir doesn't exist)
    }
  }

  close() {
    this.watcher?.close();
  }

  validateClient(apiKey: string): string | null {
    return this.clients.get(apiKey) || null;
  }
}