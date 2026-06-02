/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["simple-git"],
  // Prod uses OpenAI embeddings (USE_OPENAI_EMBEDDINGS=1); the local
  // transformers.js backend pulls onnxruntime-node (~hundreds of MB) and would
  // blow Vercel's 250MB serverless function cap. It's lazy-imported in
  // src/embeddings/local.ts, so drop it from the function bundles entirely.
  outputFileTracingExcludes: {
    "**": [
      "node_modules/@huggingface/**",
      "node_modules/onnxruntime-node/**",
      "node_modules/onnxruntime-web/**",
      "node_modules/onnxruntime-common/**",
    ],
  },
  turbopack: {},
};
export default nextConfig;
