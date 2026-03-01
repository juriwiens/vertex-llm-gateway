// src/clients.test.ts
import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { ClientManager } from "./clients.ts";
import { unlinkSync, writeFileSync, mkdirSync } from "node:fs";

describe("ClientManager", () => {
  const testConfigPath = "/tmp/clients-test.json";
  let managers: ClientManager[] = [];

  afterAll(() => {
    for (const manager of managers) {
      manager.close();
    }
    try { unlinkSync(testConfigPath); } catch {}
  });

  test("loads valid clients.json", async () => {
    writeFileSync(testConfigPath, JSON.stringify({ "key-123": "app-1" }));
    
    const manager = await ClientManager.create(testConfigPath);
    managers.push(manager);
    
    expect(manager.validateClient("key-123")).toBe("app-1");
    expect(manager.validateClient("wrong-key")).toBeNull();
  });

  test("falls back to default key if file missing", async () => {
    const manager = await ClientManager.create("/tmp/does-not-exist.json", "fallback-key");
    managers.push(manager);
    
    expect(manager.validateClient("fallback-key")).toBe("default-client");
  });
});