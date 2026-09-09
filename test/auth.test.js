import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.js";
import { createDatabase } from "../src/database/database.js";

function extractSessionCookie(response) {
  const raw = response.headers.get("set-cookie");
  if (!raw) return null;
  const match = /relay_session=([^;]+)/.exec(raw);
  return match ? match[1] : null;
}

test("register creates an organization, an owner user, and a session cookie", async (t) => {
  const client = await startClient(t);
  const res = await fetch(`${client.baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      organization_name: "Register Test Co",
      name: "Ada Lovelace",
      email: "ada@register-test.example.com",
      password: "correct-horse-battery"
    })
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.organization.name, "Register Test Co");
  assert.equal(body.user.email, "ada@register-test.example.com");
  assert.equal(body.user.organization_id, body.organization.id);
  assert.ok(extractSessionCookie(res), "expected a relay_session cookie to be set");

  const usersRow = await client.db.get("SELECT * FROM users WHERE email = ?", ["ada@register-test.example.com"]);
  assert.ok(usersRow.password_hash.includes(":"), "password should be stored hashed, not in plaintext");
  assert.notEqual(usersRow.password_hash, "correct-horse-battery");
});

test("register rejects a duplicate email and weak passwords", async (t) => {
  const client = await startClient(t);
  await fetch(`${client.baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      organization_name: "Dup Co",
      name: "First",
      email: "dup@example.com",
      password: "correct-horse-battery"
    })
  });
  const dup = await fetch(`${client.baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      organization_name: "Dup Co Two",
      name: "Second",
      email: "dup@example.com",
      password: "another-password"
    })
  });
  assert.equal(dup.status, 400);

  const weak = await fetch(`${client.baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ organization_name: "Weak Co", name: "Weak", email: "weak@example.com", password: "short" })
  });
  assert.equal(weak.status, 400);
});

test("login succeeds with the right password and fails with the wrong one, without leaking which part was wrong", async (t) => {
  const client = await startClient(t);
  await fetch(`${client.baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      organization_name: "Login Co",
      name: "Grace Hopper",
      email: "grace@login-test.example.com",
      password: "correct-horse-battery"
    })
  });

  const good = await fetch(`${client.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "grace@login-test.example.com", password: "correct-horse-battery" })
  });
  assert.equal(good.status, 200);
  assert.ok(extractSessionCookie(good));

  const wrongPassword = await fetch(`${client.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "grace@login-test.example.com", password: "not-the-password" })
  });
  const noSuchUser = await fetch(`${client.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "nobody@login-test.example.com", password: "correct-horse-battery" })
  });
  assert.equal(wrongPassword.status, 401);
  assert.equal(noSuchUser.status, 401);
  const wrongBody = await wrongPassword.json();
  const noSuchBody = await noSuchUser.json();
  assert.equal(wrongBody.error, noSuchBody.error);
});

test("the session cookie from register authenticates GET /api/auth/me, and logout invalidates it", async (t) => {
  const client = await startClient(t);
  const registerRes = await fetch(`${client.baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      organization_name: "Me Co",
      name: "Alan Turing",
      email: "alan@me-test.example.com",
      password: "correct-horse-battery"
    })
  });
  const cookie = extractSessionCookie(registerRes);

  const me = await fetch(`${client.baseUrl}/api/auth/me`, { headers: { cookie: `relay_session=${cookie}` } });
  assert.equal(me.status, 200);
  const meBody = await me.json();
  assert.equal(meBody.user.email, "alan@me-test.example.com");
  assert.equal(meBody.organization.name, "Me Co");

  const meWithoutCookie = await fetch(`${client.baseUrl}/api/auth/me`);
  assert.equal(meWithoutCookie.status, 401);

  await fetch(`${client.baseUrl}/api/auth/logout`, { method: "POST", headers: { cookie: `relay_session=${cookie}` } });
  const meAfterLogout = await fetch(`${client.baseUrl}/api/auth/me`, { headers: { cookie: `relay_session=${cookie}` } });
  assert.equal(meAfterLogout.status, 401);
});

async function startClient(t) {
  const db = await createDatabase(":memory:");
  const server = createApp({ db });
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(async () => {
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  });
  const { port } = server.address();
  return { baseUrl: `http://127.0.0.1:${port}`, db };
}
