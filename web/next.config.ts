import { existsSync } from "node:fs";
import path from "node:path";

import type { NextConfig } from "next";

// The repository .env serves API and web. Variables already set, including web/.env.local, win.
const repositoryEnv = path.resolve(process.cwd(), "..", ".env");
if (existsSync(repositoryEnv)) process.loadEnvFile(repositoryEnv);

const nextConfig: NextConfig = {
  // The status line owns the bottom edge; compile and runtime errors still surface.
  devIndicators: false,
};

export default nextConfig;
