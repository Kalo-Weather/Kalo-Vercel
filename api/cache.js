const crypto = require('crypto');
const { Redis } = require('@upstash/redis');

const CACHE_TTL_SEC = 1800;

let redis = null;
try {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
} catch (e) {
  console.error('Cache Redis init error:', e.message);
}

function locationKey(lat, lon) {
  return `${parseFloat(lat).toFixed(2)}_${parseFloat(lon).toFixed(2)}`;
}

function hashKey(lat, lon) {
  return crypto.createHash('sha256').update(locationKey(lat, lon)).digest('hex').slice(0, 16);
}

function wk(key) {
  return `cache:weather:${key}`;
}

function sk(key) {
  return `cache:stats:${key}`;
}

async function getCachedResponse(lat, lon) {
  if (!redis) return null;
  try {
    const key = hashKey(lat, lon);
    const cached = await redis.get(wk(key));
    if (!cached) {
      await redis.hincrby('cache:meta', 'misses', 1);
      return null;
    }
    await redis.hincrby('cache:meta', 'hits', 1);
    return typeof cached === 'string' ? JSON.parse(cached) : cached;
  } catch (e) {
    console.error('Cache get error:', e.message);
    return null;
  }
}

async function setCachedResponse(lat, lon, response) {
  if (!redis) return false;
  try {
    const key = hashKey(lat, lon);
    await redis.set(wk(key), JSON.stringify(response), { ex: CACHE_TTL_SEC });
    await redis.hincrby('cache:meta', 'cached', 1);
    return true;
  } catch (e) {
    console.error('Cache set error:', e.message);
    return false;
  }
}

async function recordLocationAccess(lat, lon) {
  if (!redis) return;
  try {
    const key = hashKey(lat, lon);
    await redis.hincrby(sk(key), 'count', 1);
    await redis.hset(sk(key), { last_requested: Date.now() });
    await redis.expire(sk(key), 86400);
    await redis.hincrby('cache:meta', 'total_requests', 1);
  } catch (e) {
    console.error('Cache record error:', e.message);
  }
}

async function evictStaleCache() {
  if (!redis) return;
}

async function getCacheStats() {
  if (!redis) return { error: 'Redis not configured' };
  try {
    const meta = await redis.hgetall('cache:meta') || {};
    const keys = await redis.keys('cache:weather:*');
    let locations = [];
    if (keys && keys.length > 0) {
      const entries = await Promise.all(
        keys.map(async (k) => {
          const hash = k.replace('cache:weather:', '');
          const ttl = await redis.ttl(k);
          const stats = await redis.hgetall(`cache:stats:${hash}`);
          return {
            key: hash,
            ttl,
            count: stats ? parseInt(stats.count || 0) : 0,
            hits: stats ? parseInt(stats.cache_hits || 0) : 0,
          };
        })
      );
      locations = entries.sort((a, b) => b.count - a.count);
    }
    return { ...meta, cached_locations: locations, location_count: locations.length };
  } catch (e) {
    console.error('Cache stats error:', e.message);
    return { error: e.message };
  }
}

module.exports = {
  getCachedResponse,
  setCachedResponse,
  recordLocationAccess,
  getCacheStats,
  evictStaleCache,
  hashKey,
};
