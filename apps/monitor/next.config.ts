import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@cigam-waydata/file-logger", "@cigam-waydata/shared"],
};

export default nextConfig;
