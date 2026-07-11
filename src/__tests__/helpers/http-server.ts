import http from 'http';
import { AddressInfo } from 'net';

// Shared teardown for the suites that drive a real HTTP server.
//
// Closing inline at the end of each `it()` leaked two ways: a test that threw
// before reaching its `server.close()` never closed at all, and `close()` alone
// only stops *new* connections - it leaves established keep-alive sockets open.
// The suites drive these servers with global fetch (undici), which pools exactly
// such sockets, so the handles outlived the suite and Jest force-exited the
// worker ("a worker process has failed to exit gracefully").

const started: http.Server[] = [];

/**
 * Listens on an ephemeral port, registers the server for teardown, and returns
 * its base URL. Don't call close() yourself - `afterEach(closeServers)` does it.
 */
export function listen(server: http.Server): Promise<string> {
  started.push(server);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, () => {
      const addr = server.address() as AddressInfo | null;
      if (!addr || typeof addr !== 'object' || !addr.port) {
        reject(new Error(`listen() got no port back: ${JSON.stringify(addr)}`));
        return;
      }
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

/** Destroys every server started this test, keep-alive sockets included. */
export async function closeServers(): Promise<void> {
  const servers = started.splice(0);
  await Promise.all(
    servers.map(
      server =>
        new Promise<void>(resolve => {
          server.closeAllConnections();
          server.close(() => resolve());
        })
    )
  );
}
