const { Redis } = require('@upstash/redis');
const cache = require('./cache');

let redis = null;
try {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
} catch (e) {
  console.error('Metrics Redis init error:', e.message);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (!redis) {
    return res.status(200).json({ error: 'Redis not configured', cache: {} });
  }

  try {
    const counts = await redis.hgetall('metrics:counts') || {};
    const raw = await redis.lrange('metrics:requests', 0, 49) || [];
    const last_requests = raw.map((s) => (typeof s === 'string' ? JSON.parse(s) : s));
    const cacheStats = await cache.getCacheStats();

    return res.status(200).json({
      ...Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, parseInt(v) || 0])),
      last_requests,
      cache: cacheStats,
    });
  } catch (e) {
    console.error('Metrics read error', e);
    return res.status(500).json({ error: 'Could not read metrics' });
  }
};
