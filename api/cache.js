const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '..', 'data', 'location_cache.json');
const MAX_CACHED_LOCATIONS = 10;
const CACHE_TTL_MS = 10 * 60 * 1000;

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, 'utf8') || '{}';
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Cache load error', e);
  }
  return {
    locations: {},
    config: {
      max_cached: MAX_CACHED_LOCATIONS,
      total_requests: 0,
      cache_hits: 0,
      cache_misses: 0,
      locations_evicted: 0,
      responses_cached: 0
    }
  };
}

function saveCache(cache) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
  } catch (e) {
    console.error('Cache save error', e);
  }
}

function locationKey(lat, lon) {
  return `${parseFloat(lat).toFixed(2)}_${parseFloat(lon).toFixed(2)}`;
}

function hashKey(lat, lon) {
  return crypto.createHash('sha256').update(locationKey(lat, lon)).digest('hex').slice(0, 16);
}

function getEncryptionKey() {
  const hex = process.env.CACHE_ENCRYPTION_KEY;
  if (hex && hex.length === 64) {
    return Buffer.from(hex, 'hex');
  }
  const KEY_FILE = path.join(__dirname, '..', 'data', 'cache_key.bin');
  try {
    if (fs.existsSync(KEY_FILE)) {
      return fs.readFileSync(KEY_FILE);
    }
  } catch (e) {
    /* ignore */
  }
  const key = crypto.randomBytes(32);
  try {
    fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
    fs.writeFileSync(KEY_FILE, key);
  } catch (e) {
    /* ephemeral filesystem — key lasts only this invocation */
  }
  return key;
}

function encryptResponse(data, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + encrypted.toString('hex') + ':' + authTag.toString('hex');
}

function decryptResponse(encryptedString, key) {
  try {
    const parts = encryptedString.split(':');
    if (parts.length !== 3) return null;
    const iv = Buffer.from(parts[0], 'hex');
    const data = Buffer.from(parts[1], 'hex');
    const authTag = Buffer.from(parts[2], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(data, 'binary', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  } catch (e) {
    console.error('Cache decrypt error', e.message);
    return null;
  }
}

function computeScore(entry, now, maxCount) {
  const freqWeight = 0.4;
  const recencyWeight = 0.3;
  const hitRateWeight = 0.3;

  const freq = maxCount > 0 ? entry.count / maxCount : 0;

  const age = now - entry.last_requested;
  const recency = Math.max(0, 1 - age / (24 * 3600 * 1000));

  const total = entry.count + (entry.cache_hits || 0);
  const hitRate = total > 0 ? (entry.cache_hits || 0) / total : 0;

  return freq * freqWeight + recency * recencyWeight + hitRate * hitRateWeight;
}

function getCachedResponse(lat, lon) {
  const cache = loadCache();
  const key = hashKey(lat, lon);
  const entry = cache.locations[key];
  const now = Date.now();
  const encKey = getEncryptionKey();

  if (!entry || !entry.encrypted || !entry.cached_at || (now - entry.cached_at) >= CACHE_TTL_MS) {
    cache.config.cache_misses = (cache.config.cache_misses || 0) + 1;
    saveCache(cache);
    return null;
  }

  const response = decryptResponse(entry.encrypted, encKey);
  if (!response) {
    cache.config.cache_misses = (cache.config.cache_misses || 0) + 1;
    return null;
  }

  entry.last_requested = now;
  entry.cache_hits = (entry.cache_hits || 0) + 1;
  cache.config.cache_hits = (cache.config.cache_hits || 0) + 1;
  saveCache(cache);
  return response;
}

function setCachedResponse(lat, lon, response) {
  const cache = loadCache();
  const key = hashKey(lat, lon);
  const now = Date.now();
  const encKey = getEncryptionKey();

  if (!cache.locations[key]) {
    return false;
  }

  const entry = cache.locations[key];
  entry.last_requested = now;

  const maxCount = Math.max(...Object.values(cache.locations).map(l => l.count || 0), 1);
  entry.popularity_score = computeScore(entry, now, maxCount);

  const cachedCount = Object.values(cache.locations).filter(l => l.encrypted).length;

  if (cachedCount >= cache.config.max_cached && !entry.encrypted) {
    const scores = Object.entries(cache.locations)
      .filter(([k, v]) => v.encrypted)
      .map(([k, v]) => ({ key: k, score: v.popularity_score }));
    scores.sort((a, b) => a.score - b.score);

    if (entry.popularity_score <= scores[0]?.score) {
      saveCache(cache);
      return false;
    }

    delete cache.locations[scores[0].key].encrypted;
    delete cache.locations[scores[0].key].cached_at;
    cache.config.locations_evicted = (cache.config.locations_evicted || 0) + 1;
  }

  entry.encrypted = encryptResponse(response, encKey);
  entry.cached_at = now;
  cache.config.responses_cached = (cache.config.responses_cached || 0) + 1;

  Object.keys(cache.locations).forEach(k => {
    cache.locations[k].popularity_score = computeScore(cache.locations[k], now, maxCount);
  });

  saveCache(cache);
  return true;
}

function recordLocationAccess(lat, lon) {
  const cache = loadCache();
  const key = hashKey(lat, lon);
  const now = Date.now();

  if (!cache.locations[key]) {
    cache.locations[key] = { count: 0, last_requested: now, cache_hits: 0, popularity_score: 0, encrypted: null, cached_at: null };
  }

  cache.locations[key].count = (cache.locations[key].count || 0) + 1;
  cache.locations[key].last_requested = now;
  cache.config.total_requests = (cache.config.total_requests || 0) + 1;

  const maxCount = Math.max(...Object.values(cache.locations).map(l => l.count || 0), 1);
  Object.keys(cache.locations).forEach(k => {
    cache.locations[k].popularity_score = computeScore(cache.locations[k], now, maxCount);
  });

  saveCache(cache);
}

function getCacheStats() {
  const cache = loadCache();
  const stats = { ...cache.config };
  stats.cached_locations = Object.entries(cache.locations)
    .filter(([_, v]) => v.encrypted && v.cached_at)
    .map(([k, v]) => ({
      key: k,
      score: Math.round(v.popularity_score * 100) / 100,
      count: v.count,
      hits: v.cache_hits,
      cached_seconds_ago: Math.round((Date.now() - v.cached_at) / 1000)
    }))
    .sort((a, b) => b.score - a.score);
  stats.location_count = Object.keys(cache.locations).length;
  return stats;
}

function evictStaleCache() {
  const cache = loadCache();
  const now = Date.now();
  let evicted = 0;

  Object.keys(cache.locations).forEach(k => {
    const entry = cache.locations[k];
    if (entry.cached_at && (now - entry.cached_at) > CACHE_TTL_MS) {
      delete entry.encrypted;
      delete entry.cached_at;
      evicted++;
    }
  });

  if (evicted > 0) {
    cache.config.locations_evicted = (cache.config.locations_evicted || 0) + evicted;
    saveCache(cache);
  }
}

module.exports = {
  getCachedResponse,
  setCachedResponse,
  recordLocationAccess,
  getCacheStats,
  evictStaleCache,
  hashKey
};
