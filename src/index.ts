import { Hono } from "hono";
import type { Bindings } from "./bindings";
import { health } from "./routes/health";

const app = new Hono<{ Bindings: Bindings }>();

app.route("/", health);

export default app;
export type { Bindings };
