import { createApp } from "@chessu/shared";

import { initIdentityTables } from "./db.js";
import { initPublisher } from "./publisher.js";
import { listUsers } from "./repositories/user.repository.js";
import authRoutes from "./routes/auth.route.js";
import { sessionMiddleware } from "./session.js";

const app = createApp("identity-service");
const port = Number(process.env.PORT || 4001);

await initIdentityTables();
await initPublisher();

app.use(sessionMiddleware);
app.use("/v1/auth", authRoutes);

// internal (service-to-service): lets a freshly deployed consumer initialize its copy of the users
app.get("/v1/internal/users", async (_, res) => {
    res.status(200).json(await listUsers());
});

app.listen(port, () => {
    console.log(`identity-service listening on :${port}`);
});
