import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { startClient } from "./helpers/testClient.js";

for (const [env, enabled, expected] of [["development", undefined, false], ["development", "true", true], ["test", "true", true], ["staging", "true", false], ["production", "true", false]]) {
  test("developer UI availability: " + env + " opt-in " + enabled, () => {
    assert.equal(loadConfig({NODE_ENV:env, ENABLE_DEVELOPER_TOOLS:enabled}).security.developerToolsEnabled, expected);
  });
}
test("session advertises developer tools only to an explicitly enabled current owner", async t => {
  const config=loadConfig({NODE_ENV:"test",ENABLE_DEVELOPER_TOOLS:"true",WORKER_ENABLED:"false"});
  const client=await startClient(t, ":memory:", {config});
  assert.equal((await fetch(client.baseUrl+"/api/auth/me")).status,401);
  const registered=await client.register("Developer boundary");
  assert.equal((await client.get("/api/auth/me")).capabilities.developer_tools,true);
  await client.db.run("UPDATE users SET role=? WHERE id=?",["MEMBER",registered.user.id]);
  assert.equal((await client.get("/api/auth/me")).capabilities.developer_tools,false);
});
test("test controls alone do not enable developer configuration UI",async t=>{
  const client=await startClient(t);await client.register("Default customer UI");
  const me=await client.get("/api/auth/me");assert.equal(me.capabilities.test_controls,true);assert.equal(me.capabilities.developer_tools,false);
});
