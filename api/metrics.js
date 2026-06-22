const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const METRICS_FILE = path.join(__dirname, '..', 'data', 'metrics.json');
  try {
    if (!fs.existsSync(METRICS_FILE)) {
      return res.status(200).json({ total_requests: 0, fallbacks: 0, provider_errors: 0, successes: 0, last_requests: [] });
    }
    const raw = fs.readFileSync(METRICS_FILE, 'utf8') || '{}';
    const metrics = JSON.parse(raw);
    return res.status(200).json(metrics);
  } catch (e) {
    console.error('Metrics read error', e);
    return res.status(500).json({ error: 'Could not read metrics' });
  }
};
