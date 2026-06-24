const fs = require('fs');
const path = require('path');
const cache = require('./cache');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const METRICS_FILE = path.join(__dirname, '..', 'data', 'metrics.json');
  try {
    let metrics = { total_requests: 0, fallbacks: 0, provider_errors: 0, successes: 0, last_requests: [] };
    if (fs.existsSync(METRICS_FILE)) {
      const raw = fs.readFileSync(METRICS_FILE, 'utf8') || '{}';
      metrics = JSON.parse(raw);
    }
    metrics.cache = cache.getCacheStats();
    return res.status(200).json(metrics);
  } catch (e) {
    console.error('Metrics read error', e);
    return res.status(500).json({ error: 'Could not read metrics' });
  }
};
