import { createApp, type Config } from "./app";
import { Storage } from "./storage";
const passwords = {
  father: process.env.FATHER_PASSWORD || "",
  mother: process.env.MOTHER_PASSWORD || "",
  daughter: process.env.DAUGHTER_PASSWORD || "",
};
if (
  Object.values(passwords).some((p) => !p) ||
  new Set(Object.values(passwords)).size !== 3
)
  throw new Error(
    "Задайте три различных непустых пароля: FATHER_PASSWORD, MOTHER_PASSWORD, DAUGHTER_PASSWORD",
  );
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)
  throw new Error("SESSION_SECRET должен содержать не менее 32 символов");
const config: Config = {
  passwords,
  secret: process.env.SESSION_SECRET,
  dataPath: process.env.DATA_PATH || "data/state.json",
  secure: process.env.COOKIE_SECURE === "true",
  trustedProxy: process.env.TRUSTED_PROXY || undefined,
};
const storage = new Storage(config.dataPath);
await storage.init();
const port = Number(process.env.PORT || 8080);
const server = createApp(config, storage).listen(port, "0.0.0.0", () =>
  console.log(`Семейный парламент: http://localhost:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));
