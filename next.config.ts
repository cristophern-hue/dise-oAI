import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel's modifyConfig does path.resolve(config.outputFileTracingRoot || repoRootEnvVar).
  // The default '' is falsy, so if VERCEL_MONOREPO_ROOT is unset it becomes path.resolve(undefined) → crash.
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
