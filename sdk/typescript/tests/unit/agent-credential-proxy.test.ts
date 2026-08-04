import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";

import { AgentCredentialProxy } from "../../src/agent/index.js";

test("credential proxy injects secrets only for a scoped upstream request and revokes leases", async () => {
  let observedAuthorization = "";
  let observedBody = "";
  const upstream = createServer(async (req, res) => {
    observedAuthorization = String(req.headers.authorization || "");
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    observedBody = Buffer.concat(chunks).toString("utf8");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  const upstreamPort = await listen(upstream);
  const proxy = new AgentCredentialProxy([{
    id: "test-api",
    sourceEnv: "TEST_UPSTREAM_TOKEN",
    allowedUrlPrefixes: ["http://127.0.0.1:" + upstreamPort + "/api/"],
    allowedMethods: ["POST"],
  }], {
    credentialProvider: (name) => name === "TEST_UPSTREAM_TOKEN" ? "private-upstream-token" : undefined,
    allowHttpLocalhost: true,
  });

  try {
    const lease = await proxy.acquire("session-a");
    const endpoint = lease.env.NEMOS_CREDENTIAL_PROXY_URL!;
    const token = lease.env.NEMOS_CREDENTIAL_PROXY_TOKEN!;
    const response = await fetch(endpoint + "/v1/fetch", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + token,
      },
      body: JSON.stringify({
        credentialId: "test-api",
        url: "http://127.0.0.1:" + upstreamPort + "/api/resource",
        method: "POST",
        headers: { "content-type": "application/json", authorization: "attacker-value" },
        body: JSON.stringify({ query: "hello" }),
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(observedAuthorization, "Bearer private-upstream-token");
    assert.equal(observedBody, JSON.stringify({ query: "hello" }));

    const outsideScope = await fetch(endpoint + "/v1/fetch", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + token },
      body: JSON.stringify({
        credentialId: "test-api",
        url: "http://127.0.0.1:" + upstreamPort + "/outside",
      }),
    });
    assert.equal(outsideScope.status, 403);

    lease.close();
    const expired = await fetch(endpoint + "/v1/fetch", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + token },
      body: "{}",
    });
    assert.equal(expired.status, 401);
  } finally {
    await proxy.close();
    await close(upstream);
  }
});

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("test server did not expose a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
