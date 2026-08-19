import { Hono } from "hono";
import type { Bindings } from "./bindings";
import { health } from "./routes/health";
import { commentsRoute } from "./routes/comments";

const app = new Hono<{ Bindings: Bindings }>();

app.route("/", health);
app.route("/", commentsRoute);

export default app;
export type { Bindings };
