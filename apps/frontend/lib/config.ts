const defaultSiteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tronrelic.com';

export const config = {
  apiBaseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api',
  socketUrl: process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:4000',
  siteUrl: defaultSiteUrl.replace(/\/$/, '') || 'https://tronrelic.com'
};
