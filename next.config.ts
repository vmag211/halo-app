import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Isolated browser verification never competes with the user's dev output.
  distDir: process.env.HALO_STAGE_TEST === '1' ? '.next-stage-test' : '.next',
};

export default nextConfig;
