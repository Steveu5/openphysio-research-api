// Loads exactly one env file for the selected environment:
//   development -> .env.development.local   test -> .env.test.local
//   production  -> .env (or the platform's variables, as today)
//   test without .env.test.local -> no file at all (never the production .env)
// When an environment-specific file exists, `.env` is NOT loaded, so production
// secrets kept there can never fill gaps in a development or test setup.
// Variables already present in the process always win (dotenv default).

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { resolveAppEnvironment, assertSafeEnvironment } = require("./environmentGuard");

function loadEnvironment({ root = path.resolve(__dirname, "..", ".."), env = process.env } = {}) {
  const appEnv = resolveAppEnvironment(env);
  const specific = path.join(root, `.env.${appEnv}.local`);
  let file = path.join(root, ".env");
  if (appEnv !== "production" && fs.existsSync(specific)) file = specific;
  else if (appEnv === "test") file = null; // tests never read .env: synthetic values only
  if (file) dotenv.config({ path: file, processEnv: env, quiet: true });
  if (!env.APP_ENV && appEnv !== "production") env.APP_ENV = appEnv;
  // Re-check after loading: a NODE_ENV=development inside .env counts too.
  const { appEnv: effective } = assertSafeEnvironment(env);
  return { appEnv: effective, file: file ? path.basename(file) : null };
}

module.exports = { loadEnvironment };
