const pubsub = require('./pubsub');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const since = parseInt(req.query.since, 10) || 0;
  const channels = req.query.channels ? req.query.channels.split(',') : null;

  try {
    const events = await pubsub.getPending(since, channels);
    return res.status(200).json({ events, since: Date.now() });
  } catch (e) {
    console.error('Notifications error:', e);
    return res.status(500).json({ error: 'Could not read notifications' });
  }
};
