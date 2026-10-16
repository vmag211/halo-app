import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Isolated browser verification never competes with the user's dev output.
  distDir: process.env.HALO_STAGE_TEST === '1' ? (process.env.HALO_STAGE_TEST_DIR && /^\.next-stage-test-[a-z0-9-]+$/.test(process.env.HALO_STAGE_TEST_DIR) ? process.env.HALO_STAGE_TEST_DIR : '.next-stage-test') : '.next',
};

export default nextConfig;
