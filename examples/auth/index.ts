import { serve } from "@hono/node-server";
import app from "./routes.js";

serve(app, (info) => {
  console.log(`Auth API running → http://localhost:${info.port}`);
  console.log(`Docs (Scalar) → http://localhost:${info.port}/docs`);
  console.log(`OpenAPI spec → http://localhost:${info.port}/openapi.json`);
});
