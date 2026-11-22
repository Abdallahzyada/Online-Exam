import { jest, describe, it, expect } from "@jest/globals";
import { ShutdownStack } from "./shutdown.js";

describe("ShutdownStack", () => {
  it("stops resources newest-first so HTTP Drains before worker and database", async () => {
    const calls: string[] = [];
    const stack = new ShutdownStack();
    stack.add(async () => {
      calls.push("database");
    });
    stack.add(async () => {
      calls.push("workers");
    });
    stack.add(() => {
      calls.push("monitor");
    });
    stack.add(async () => {
      calls.push("http");
    });
    await stack.stop();
    expect(calls).toEqual(["http", "monitor", "workers", "database"]);
  });
  it("Keep the database open untile admitted request finish", async () => {
    let finish: (() => void) | undefined;
    const closeDatabase = jest.fn<() => Promise<void>>().mockResolvedValue();
    const stack = new ShutdownStack();
    stack.add(closeDatabase);
    stack.add(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const stopping = stack.stop();
    await Promise.resolve();
    expect(closeDatabase).not.toHaveBeenCalled();
    finish?.();
    await stopping;
    expect(closeDatabase).toHaveBeenCalledTimes(1);
  });
  it("runs only once and still closes later steps when one fails", async () => {
    const closeDatabase = jest.fn<() => Promise<void>>().mockResolvedValue();
    const stack = new ShutdownStack();
    stack.add(closeDatabase);
    stack.add(async () => {
      throw new Error("Worker Failed");
    });
    const first = stack.stop();
    expect(stack.stop()).toBe(first);
    await expect(first).rejects.toBeInstanceOf(AggregateError);
    expect(closeDatabase).toHaveBeenCalledTimes(1);
  });
});
