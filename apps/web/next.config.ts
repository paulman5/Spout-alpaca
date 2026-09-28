import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@spout/shared"],
  outputFileTracingRoot: require("node:path").join(__dirname, "../../"),
};

export default nextConfig;
