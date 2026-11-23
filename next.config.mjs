import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['pg', 'node-ical', 'svg-captcha'],
  webpack(config) { config.resolve.alias['@'] = __dirname; return config; },
  experimental: { serverActions: { bodySizeLimit: '22mb' } },
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(self), geolocation=()' },
      ],
    }];
  },
};
export default nextConfig;
