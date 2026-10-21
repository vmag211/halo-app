import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev route indicator sits bottom-left over the phone navigation's first tab and swallows its
  // clicks in browser tests. Compile and runtime errors are still surfaced in development.
  devIndicators: false,
  // Isolated browser verification never competes with the user's dev output.
  distDir: process.env.HALO_STAGE_TEST === '1' ? (process.env.HALO_STAGE_TEST_DIR && /^\.next-stage-test-[a-z0-9-]+$/.test(process.env.HALO_STAGE_TEST_DIR) ? process.env.HALO_STAGE_TEST_DIR : '.next-stage-test') : '.next',
};

export default nextConfig;
