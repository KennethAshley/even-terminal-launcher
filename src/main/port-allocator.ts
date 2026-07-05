import { createServer } from "node:net";

const MIN_PORT = 1;
const MAX_PORT = 65_535;

export function assertValidPort(port: number): void {
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new RangeError(`Invalid TCP port: ${port}`);
  }
}

export function isPortAvailable(
  port: number,
  host = "127.0.0.1"
): Promise<boolean> {
  assertValidPort(port);

  return new Promise((resolve) => {
    const server = createServer();
    let settled = false;

    const finish = (available: boolean): void => {
      if (settled) return;
      settled = true;
      server.removeAllListeners();
      if (server.listening) {
        server.close(() => resolve(available));
      } else {
        resolve(available);
      }
    };

    server.unref();
    server.once("error", () => finish(false));
    server.once("listening", () => finish(true));
    server.listen({ port, host, exclusive: true });
  });
}

export async function findAvailablePort(
  startPort: number,
  endPort = Math.min(startPort + 100, MAX_PORT),
  host = "127.0.0.1"
): Promise<number> {
  assertValidPort(startPort);
  assertValidPort(endPort);
  if (endPort < startPort) {
    throw new RangeError("endPort must be greater than or equal to startPort");
  }

  for (let port = startPort; port <= endPort; port += 1) {
    if (await isPortAvailable(port, host)) return port;
  }

  throw new Error(`No available TCP port in range ${startPort}-${endPort}`);
}

/**
 * Prevents two launcher-managed profiles from claiming the same port while also
 * checking that no external process is currently listening on it.
 *
 * The OS check and child bind cannot be atomic. Keeping the in-process claim until
 * the child exits closes the important race between concurrent profile starts.
 */
export class PortAllocator {
  private readonly owners = new Map<number, string>();
  private operationQueue: Promise<void> = Promise.resolve();

  async claim(profileId: string, ports: readonly number[]): Promise<void> {
    const operation = this.operationQueue.then(
      () => this.claimExclusive(profileId, ports),
      () => this.claimExclusive(profileId, ports)
    );
    this.operationQueue = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  private async claimExclusive(
    profileId: string,
    ports: readonly number[]
  ): Promise<void> {
    const uniquePorts = new Set(ports);
    if (uniquePorts.size !== ports.length) {
      throw new Error(`Profile ${profileId} assigns the same port more than once`);
    }

    for (const port of ports) {
      assertValidPort(port);
      const owner = this.owners.get(port);
      if (owner && owner !== profileId) {
        throw new Error(`Port ${port} is already reserved by profile ${owner}`);
      }
    }

    const newlyClaimed: number[] = [];
    try {
      for (const port of ports) {
        if (this.owners.get(port) === profileId) continue;
        if (!(await isPortAvailable(port))) {
          throw new Error(`Port ${port} is already in use`);
        }
        this.owners.set(port, profileId);
        newlyClaimed.push(port);
      }
    } catch (error) {
      for (const port of newlyClaimed) this.owners.delete(port);
      throw error;
    }
  }

  release(profileId: string): void {
    for (const [port, owner] of this.owners) {
      if (owner === profileId) this.owners.delete(port);
    }
  }

  ownerOf(port: number): string | null {
    return this.owners.get(port) ?? null;
  }
}
