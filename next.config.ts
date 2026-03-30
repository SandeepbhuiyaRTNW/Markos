import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactCompiler: true,
  serverExternalPackages: ["pg", "pg-pool", "pg-native"],
};

export default nextConfig;
