/**
 * Self-check for lib/openapi.ts spike.
 * Four assertions:
 *   1. /openapi.json emits minimum/maximum in spec
 *   2. Query param coercion works (string "5" → number 5)
 *   3. Bad body returns 400 with error summary
 *   4. Recursive schema: $defs hoisted to components, $ref pointers rewritten
 */

import { scope, type } from "arktype";
import { OpenAPIHono } from "./openapi.js";

const app = new OpenAPIHono();

// ── POST /things — body with numeric range ────────────────────────
app.openapi(
	{
		method: "POST",
		path: "/things",
		summary: "Create a thing",
		request: {
			body: type({
				name: "string >= 1",
				count: "1 <= number.integer <= 100",
			}),
		},
		responses: { 201: type({ id: "string" }) },
	},
	async () => {
		return { id: crypto.randomUUID() };
	},
);

// ── GET /search — query with coercing number ──────────────────────
app.openapi(
	{
		method: "GET",
		path: "/search",
		summary: "Search things",
		request: {
			query: type({
				q: "string",
				limit: "1 <= number.integer <= 100",
			}),
		},
	},
	async ({ query }) => {
		const q = query as { q: string; limit: number };
		return { q: q.q, limit: q.limit };
	},
);

// ── GET /tree — recursive schema ($defs + $ref) ───────────────────
// ArkType's toJsonSchema() emits $defs and $ref pointers for recursive types.
// The library must hoist $defs to components/schemas and rewrite all refs.
const $tree = scope({ Tree: { label: "string", children: "Tree[]" } });
const Tree = $tree.export().Tree;

app.openapi(
	{
		method: "GET",
		path: "/tree",
		summary: "Get a tree",
		responses: { 200: Tree },
	},
	async () => ({ label: "root", children: [] }),
);

// ── OpenAPI docs ──────────────────────────────────────────────────
app.doc("/openapi.json", {
	info: { title: "Spike API", version: "0.0.1" },
});

// ── Run checks ────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

async function check(name: string, fn: () => Promise<void>) {
	try {
		await fn();
		passed++;
		console.log(`  ✅ ${name}`);
	} catch (e: any) {
		failed++;
		console.log(`  ❌ ${name}: ${e.message}`);
	}
}

// ── Assertion 1: OpenAPI spec has minimum/maximum ─────────────────
async function assertSpec() {
	const res = await app.request("/openapi.json");
	if (res.status !== 200) throw new Error(`spec endpoint returned ${res.status}`);

	const spec: any = await res.json();

	// Check POST /things body has minimum/maximum on count
	const postThing = spec.paths?.["/things"]?.post;
	if (!postThing) throw new Error("POST /things not in spec");
	const bodySchema = postThing.requestBody?.content?.["application/json"]?.schema;
	if (!bodySchema) throw new Error("request body schema missing");
	const count = bodySchema?.properties?.count;
	if (!count) throw new Error("count property missing in body schema");
	if (count.minimum !== 1) throw new Error(`expected minimum:1, got ${count.minimum}`);
	if (count.maximum !== 100) throw new Error(`expected maximum:100, got ${count.maximum}`);
	if (count.type !== "integer") throw new Error(`expected type:integer, got ${count.type}`);

	// Auto-documented framework error: 400 on validated endpoints (no auth → no 401 here)
	const thingResponses = postThing.responses ?? {};
	const r400 = thingResponses["400"];
	if (!r400) throw new Error("POST /things missing auto-documented 400 response");
	if (r400.description !== "Bad Request")
		throw new Error(`400 description expected 'Bad Request', got ${r400.description}`);

	// Check GET /search query parameter has minimum/maximum
	const getSearch = spec.paths?.["/search"]?.get;
	if (!getSearch) throw new Error("GET /search not in spec");
	const limitParam = getSearch.parameters?.find((p: any) => p.name === "limit");
	if (!limitParam) throw new Error("limit query param missing");
	if (limitParam.schema?.minimum !== 1)
		throw new Error(`expected schema.minimum:1, got ${limitParam.schema?.minimum}`);
	if (limitParam.schema?.maximum !== 100)
		throw new Error(`expected schema.maximum:100, got ${limitParam.schema?.maximum}`);
}

// ── Assertion 2: Coercion ─────────────────────────────────────────
async function assertCoercion() {
	const res = await app.request("/search?q=foo&limit=5");
	if (res.status !== 200) throw new Error(`search returned ${res.status}`);
	const body: any = await res.json();
	if (typeof body.limit !== "number")
		throw new Error(`expected limit to be number, got ${typeof body.limit}`);
	if (body.limit !== 5) throw new Error(`expected limit=5, got ${body.limit}`);
	if (body.q !== "foo") throw new Error(`expected q=foo, got ${body.q}`);
}

// ── Assertion 3: Validation error returns 400 ─────────────────────
async function assertValidation() {
	const res = await app.request("/things", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ name: "", count: 0 }),
	});
	if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
	const body: any = await res.json();
	if (!body.error) throw new Error(`expected error field in response`);
	if (typeof body.error !== "string" || body.error.length === 0)
		throw new Error(`error must be a non-empty string`);
}

// ── Assertion 4: Recursive schema $ref rewriting ──────────────────
async function assertRefRewriting() {
	const res = await app.request("/openapi.json");
	if (res.status !== 200) throw new Error(`spec endpoint returned ${res.status}`);
	const spec: any = await res.json();
	const specStr = JSON.stringify(spec);

	// No $defs key should remain anywhere in the spec
	if (specStr.includes('"$defs"')) throw new Error("spec still contains $defs key");

	// No $ref should point to #/$defs/ (all should be rewritten)
	if (specStr.includes("#/$defs/")) throw new Error("spec still contains #/$defs/ refs");

	// All $ref values must point to #/components/schemas/
	const refMatches = specStr.match(/"\$ref":"([^"]+)"/g) ?? [];
	for (const refMatch of refMatches) {
		const refValue = refMatch.match(/"\$ref":"([^"]+)"/)![1]!;
		if (!refValue.startsWith("#/components/schemas/"))
			throw new Error(`ref ${refValue} does not point to #/components/schemas/`);
	}

	// Component schema names must use stable hash format (schema_<12hex>)
	const schemaKeys = Object.keys(spec.components?.schemas ?? {});
	if (schemaKeys.length === 0) throw new Error("no schemas in components.schemas");
	for (const key of schemaKeys) {
		if (!/^schema_[a-f0-9]{12}$/.test(key))
			throw new Error(`schema name "${key}" does not match schema_<12hex> format`);
	}
}

// ── Run ───────────────────────────────────────────────────────────
console.log("=== OpenAPIHono spike self-check ===");
console.log();

await check("OpenAPI spec has minimum/maximum", assertSpec);
await check("Query coercion string→number", assertCoercion);
await check("Validation error returns 400", assertValidation);
await check("Recursive schema $ref rewriting", assertRefRewriting);

console.log();
console.log(`Result: ${passed}/4 passed, ${failed} failed`);

if (failed > 0) process.exit(1);
