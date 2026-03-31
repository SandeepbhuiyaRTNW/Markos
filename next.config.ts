import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactCompiler: true,
  serverExternalPackages: ["pg", "pg-pool", "pg-native"],
  // Pass env vars through to SSR runtime (needed for Amplify)
  env: {
    DATABASE_URL: process.env.DATABASE_URL,
    DB_HOST: process.env.DB_HOST,
    DB_PORT: process.env.DB_PORT,
    DB_NAME: process.env.DB_NAME,
    DB_USER: process.env.DB_USER,
    DB_PASSWORD: process.env.DB_PASSWORD,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
    ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID,
    S3_BUCKET: process.env.S3_BUCKET,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    SES_ACCESS_KEY_ID: process.env.SES_ACCESS_KEY_ID,
    SES_SECRET_ACCESS_KEY: process.env.SES_SECRET_ACCESS_KEY,
    SES_SENDER_EMAIL: process.env.SES_SENDER_EMAIL,
    SES_REGION: process.env.SES_REGION,
  },
};

export default nextConfig;
