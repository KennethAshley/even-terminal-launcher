import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertValidPort,
  isPortAvailable,
  PortAllocator
} from "../src/main/port-allocator.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        })
    )
  );
});

async function listenOnRandomPort(): Promise<{ server: Server; port: number }> {
  const server = createServer();
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not receive a TCP port");
  }
  return { server, port: address.port };
}

describe("port allocator", () => {
  it("detects a port held by another process", async () => {
    const { port } = await listenOnRandomPort();

    await expect(isPortAvailable(port)).resolves.toBe(false);
    await expect(new PortAllocator().claim("profile-a", [port])).rejects.toThrow(
      `Port ${port} is already in use`
    );
  });

  it("serializes concurrent claims and releases ownership", async () => {
    const { server, port } = await listenOnRandomPort();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    servers.splice(servers.indexOf(server), 1);

    const allocator = new PortAllocator();
    const results = await Promise.allSettled([
      allocator.claim("profile-a", [port]),
      allocator.claim("profile-b", [port])
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const owner = allocator.ownerOf(port);
    expect(["profile-a", "profile-b"]).toContain(owner);

    if (!owner) throw new Error("Expected a port owner");
    allocator.release(owner);
    expect(allocator.ownerOf(port)).toBeNull();
  });

  it("rejects invalid and duplicate port assignments", async () => {
    expect(() => assertValidPort(0)).toThrow(RangeError);
    expect(() => assertValidPort(65_536)).toThrow(RangeError);

    await expect(
      new PortAllocator().claim("profile-a", [3456, 3456])
    ).rejects.toThrow("assigns the same port more than once");
  });
});
