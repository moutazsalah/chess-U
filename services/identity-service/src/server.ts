import { createApp } from "@chessu/shared";
import cors from "cors";

import { initIdentityTables } from "./db.js";
import { initPublisher } from "./publisher.js";
import authRoutes from "./routes/auth.route.js";
import { sessionMiddleware } from "./session.js";

const app = createApp("identity-service");
const port = Number(process.env.PORT || 4001);
const corsOrigin = process.env.CORS_ORIGIN || "http://localhost:3000";

await initIdentityTables();
await initPublisher();

app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(sessionMiddleware);
app.use("/v1/auth", authRoutes);

app.listen(port, () => {
    console.log(`identity-service listening on :${port}`);
});
