/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["better-sqlite3", "simple-git"],
  turbopack: {},
};
export default nextConfig;
