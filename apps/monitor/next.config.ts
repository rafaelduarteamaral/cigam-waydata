import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  basePath,
  transpilePackages: ["@cigam-waydata/file-logger", "@cigam-waydata/shared"],
};

export default nextConfig;
