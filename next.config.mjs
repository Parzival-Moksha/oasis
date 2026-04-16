// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// OASIS - Next.js Configuration
// The 3D engine where words become matter
// ─═̷─═̷─🔥─═̷─═̷─ Standalone mode — no longer nested in Parzival monorepo ─═̷─═̷─🔥─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Blue-green builds: NEXT_DIST_DIR=.next-staging for dev:agent mode
  ...(process.env.NEXT_DIST_DIR && { distDir: process.env.NEXT_DIST_DIR }),

  // Transpile Three.js packages
  transpilePackages: ['three'],

  // Allow loading models from external sources if needed
  images: {
    unoptimized: true,
  },

  // Expose empty basePath to client code — root-served, no /oasis prefix
  env: {
    NEXT_PUBLIC_BASE_PATH: '',
  },

  // Disable HMR in dev mode (use DISABLE_HMR=1 pnpm dev)
  ...(process.env.DISABLE_HMR === '1' && {
    webpack: (config, { dev }) => {
      if (dev) {
        config.watchOptions = { ignored: /.*/ }
      }
      return config
    },
  }),

  // Serve /presentation as static HTML (reveal.js slides)
  async rewrites() {
    return {
      afterFiles: [
        {
          source: '/presentation',
          destination: '/presentation/index.html',
        },
      ],
    }
  },

  // ─═̷─═̷─🔒─═̷─═̷─ Security headers ─═̷─═̷─🔒─═̷─═̷─
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        // Allow first-party mic/camera features on Oasis itself while keeping geolocation off.
        { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
      ],
    }]
  },
}

export default nextConfig
