/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async headers() { return [{ source: "/:path*", headers: [{ key: "X-Content-Type-Options", value: "nosniff" }, { key: "Referrer-Policy", value: "same-origin" }, { key: "X-Frame-Options", value: "DENY" }] }]; },
  // 校内私有化部署优先：不做外部图片优化、不带遥测外联。
  images: { unoptimized: true },
  // 上级目录另有 lockfile，不指定的话 Next 会把工作区根推断到用户主目录。
  outputFileTracingRoot: import.meta.dirname,
  outputFileTracingIncludes: { '/api/materials/original': ['./assets/eight-lab-original.docx'] },
};

export default nextConfig;
