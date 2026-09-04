/* SSRF 防护：仅允许公网 http/https，拒绝私网/回环/云元数据/危险端口 */
const BLOCKED_HOSTS = /^(localhost|metadata\.google\.internal|169\.254\.169\.254)$/i;
const PRIVATE_IP = /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1$|fe80:|fd00:|fc00:)/i;
const BLOCKED_PORTS = new Set(['2181', '3306', '5432', '6379', '9200', '11211', '27017', '8000', '8080', '8081', '8888', '9000']);

export function safePublicUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    const host = u.hostname.toLowerCase();
    if (BLOCKED_HOSTS.test(host)) return null;
    if (PRIVATE_IP.test(host)) return null;
    const port = u.port || (u.protocol === 'https:' ? '443' : '80');
    if (BLOCKED_PORTS.has(port)) return null;
    return u;
  } catch {
    return null;
  }
}
