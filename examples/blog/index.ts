// Route files are imported for side effects — calling api() at the top level
// registers each route on the shared app from setup.ts.
import "./posts.js";
import "./comments.js";

import { serve } from "@hono/node-server";
import { app, docs } from "./setup.js";

// Mount docs. The spec builds lazily on the /openapi.json request, so docs()
// need not be the last call — what matters is that the route files above were
// imported first (their top-level api() calls register routes; Hono matches in
// registration order). Options-object form; positional docs() also works.
docs({ specPath: "/openapi.json", uiPath: "/docs" });

serve(app, (info) => {
  console.log(`Blog API → http://localhost:${info.port}`);
  console.log(`Docs (Scalar) → http://localhost:${info.port}/docs`);
  console.log(`OpenAPI spec → http://localhost:${info.port}/openapi.json`);
});
