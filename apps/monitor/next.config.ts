import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/WayData/monitor";

const nextConfig: NextConfig = {
  basePath,
  skipTrailingSlashRedirect: true,
  transpilePackages: ["@cigam-waydata/file-logger", "@cigam-waydata/shared"],
};

export default nextConfig;
