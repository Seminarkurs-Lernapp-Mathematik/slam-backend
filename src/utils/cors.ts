/**
 * CORS utility functions
 */

export function getCorsHeaders(origin?: string): HeadersInit {
  const allowedOrigins = [
    'https://learn-smart.app',
    'https://www.learn-smart.app',
  ];

  // Allow localhost for development
  const isLocalhost =
    origin?.startsWith('http://localhost') || origin?.startsWith('http://127.0.0.1');

  const allowOrigin =
    isLocalhost || (origin && allowedOrigins.includes(origin)) ? origin : '*';

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    'Access-Control-Max-Age': '86400',
  };
}
