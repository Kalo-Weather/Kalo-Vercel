const EventEmitter = require('events');
const { Redis } = require('@upstash/redis');

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

const MAX_PERSISTED = 200;

let redis = null;
try {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
} catch (e) {
  console.error('Pubsub Redis init error:', e.message);
}

async function publish(channel, data) {
  const event = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    channel,
    data,
    timestamp: Date.now(),
  };

  emitter.emit(channel, event);

  if (redis) {
    try {
      await redis.lpush('notifications:list', JSON.stringify(event));
      await redis.ltrim('notifications:list', 0, MAX_PERSISTED - 1);
    } catch (e) {
      console.error('Redis publish error:', e.message);
    }
  }
}

function subscribe(channel, handler) {
  emitter.on(channel, handler);
  return () => emitter.off(channel, handler);
}

async function getPending(since = 0, channels = null) {
  if (redis) {
    try {
      const raw = await redis.lrange('notifications:list', 0, -1);
      if (!raw || !raw.length) return [];
      const all = raw.map((s) => (typeof s === 'string' ? JSON.parse(s) : s)).reverse();
      return all.filter((n) => {
        if (n.timestamp <= since) return false;
        if (channels && !channels.includes(n.channel)) return false;
        return true;
      });
    } catch (e) {
      console.error('Redis getPending error:', e.message);
    }
  }
  return [];
}

module.exports = { publish, subscribe, getPending, emitter };
