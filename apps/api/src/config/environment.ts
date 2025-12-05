import dotenv from 'dotenv';
import path from 'path';

let envLoaded = false;

/**
 * Loads environment variables for both local development and production builds.
 * - Tries the per-app .env file first (apps/api/.env)
 * - Falls back to repo root .env so turborepo users can share config
 * The guard ensures we only run dotenv once even if multiple modules import this file.
 */
function loadEnv() {
  if (envLoaded) return;

  const appEnvPath = path.resolve(__dirname, '../.env');
  dotenv.config({ path: appEnvPath });
  dotenv.config();

  envLoaded = true;
}

loadEnv();

export {}; // Silence isolatedModules / ensure module scope
