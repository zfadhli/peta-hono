// Tests the basic example app: hello, things, search, legacy + OpenAPI/docs.
// Uses `app.request()` directly (Hono's fetch handler) — no server boot needed.

import { describe, expect, it } from "vitest";
import app from "./routes.js";

const auth = { authorization: "Bearer secret" };

describe("basic example app", () => {
  it("GET /hello/:name — with auth", async () => {
    const res = await app.request("/hello/world", { headers: auth });
    expect(res.status, "hello status").toBe(200);
    const body: any = await res.json();
    expect(body.message, "hello body").toBe("Hello world!");
  });

  it("GET /hello/:name — no auth", async () => {
    const res = await app.request("/hello/world");
    expect(res.status, "hello no auth status").toBe(401);
    const body: any = await res.json();
    expect(body.error, "hello no auth body").toBe("Unauthorized");
  });

  it("POST /things — happy path", async () => {
    const res = await app.request("/things", {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ name: "test", count: 5 }),
    });
    expect(res.status, "things status").toBe(201);
    const body: any = await res.json();
    expect(typeof body.id, "things id type").toBe("string");
    expect(body.userId, "things userId from auth").toBe("alice");
  });

  it("POST /things — count too high", async () => {
    const res = await app.request("/things", {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ name: "test", count: 500 }),
    });
    expect(res.status, "things high count status").toBe(400);
    const body: any = await res.json();
    expect(body.error, "things high count body").toBe("count too high");
  });

  it("POST /things — bad body (empty name, missing count)", async () => {
    const res = await app.request("/things", {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ name: "" }),
    });
    expect(res.status, "things bad body status").toBe(400);
    const body: any = await res.json();
    expect(typeof body.error, "things bad body format").toBe("string");
  });

  it("GET /search — happy path", async () => {
    const res = await app.request("/search?q=hello", { headers: auth });
    expect(res.status, "search status").toBe(200);
    const body: any = await res.json();
    expect(Array.isArray(body.results), "search results type").toBe(true);
    expect(body.total, "search default limit").toBe(10);
  });

  it("GET /search — missing query", async () => {
    const res = await app.request("/search", { headers: auth });
    expect(res.status, "search missing query status").toBe(400);
  });

  it("OpenAPI spec documents all routes", async () => {
    const res = await app.request("/openapi.json");
    expect(res.status, "spec status").toBe(200);
    const spec: any = await res.json();
    const paths = Object.keys(spec.paths);
    expect(paths, "spec has hello").toContain("/hello/{name}");
    expect(paths, "spec has things").toContain("/things");
    expect(paths, "spec has search").toContain("/search");
  });

  it("Docs UI returns HTML", async () => {
    const res = await app.request("/docs");
    expect(res.status, "docs status").toBe(200);
    const html = await res.text();
    expect(html.includes("Scalar"), "docs content").toBe(true);
  });
});
