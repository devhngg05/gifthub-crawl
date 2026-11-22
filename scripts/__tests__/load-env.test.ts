import { afterEach, describe, expect, it, vi } from "vitest";

const { configMock } = vi.hoisted(() => ({
  configMock: vi.fn(
    (): { parsed?: Record<string, string>; error?: Error } => ({ parsed: {} }),
  ),
}));

vi.mock("dotenv", () => ({
  default: {
    config: configMock,
  },
  config: configMock,
}));

afterEach(() => {
  configMock.mockClear();
  vi.resetModules();
});

describe("scripts/load-env", () => {
  it("loads .env.local quietly on module import and via loadEnv()", async () => {
    const { loadEnv } = await import("../load-env");

    expect(configMock).toHaveBeenCalledTimes(1);
    expect(configMock).toHaveBeenCalledWith({
      path: ".env.local",
      quiet: true,
    });

    loadEnv();
    expect(configMock).toHaveBeenCalledTimes(2);
    expect(configMock).toHaveBeenLastCalledWith({
      path: ".env.local",
      quiet: true,
    });
  });

  it("does not throw on CI when .env.local does not exist", async () => {
    const { loadEnv } = await import("../load-env");
    configMock.mockClear();

    const missingFileError = Object.assign(new Error("ENOENT: no such file"), {
      code: "ENOENT",
    });
    configMock.mockImplementationOnce(() => ({
      error: missingFileError,
    }));

    expect(() => loadEnv()).not.toThrow();
    expect(configMock).toHaveBeenCalledTimes(1);
    expect(configMock).toHaveBeenCalledWith({
      path: ".env.local",
      quiet: true,
    });
  });
});
