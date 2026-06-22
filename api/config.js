module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  return res.status(200).json({
    minimum_app_version: '1.0.0',
    latest_app_version: '1.2.0',
    engine_state: {
      interactive_maps: 'online',
      historical_weather_machine: 'online'
    },
    global_system_notices: {
      active: false,
      message: ''
    }
  });
};
