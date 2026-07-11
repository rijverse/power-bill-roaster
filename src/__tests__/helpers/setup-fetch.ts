import { Agent, setGlobalDispatcher } from 'undici';

// The web suites drive real HTTP servers with global fetch. Node's fetch is undici,
// and undici pools keep-alive sockets per origin - but every test gets a *fresh*
// origin (an ephemeral port), so those pooled sockets are never reused, they just
// accumulate: they outlive the server that owns them, keep the worker alive at
// teardown, and pile up ephemeral ports until a connection intermittently fails.
//
// setGlobalDispatcher writes the same global symbol Node's built-in fetch reads,
// so this applies to plain `fetch(...)` in the tests. Closing connections as soon
// as a response is done keeps the socket count flat across a run.
setGlobalDispatcher(
  new Agent({ keepAliveTimeout: 1, keepAliveMaxTimeout: 1, pipelining: 0, connections: 1 })
);
