'use strict';

/**
 * Open-Meteo – free weather API, no API key required.
 * Reference: https://open-meteo.com/en/docs
 *
 * No credentials required. CORS-enabled.
 * The /forecast endpoint requires at minimum `latitude` and `longitude`
 * query parameters (pass them via `where`).
 *
 * Useful where parameters:
 *  latitude, longitude         – required coordinates
 *  current_weather             – "true" to include current conditions
 *  hourly                      – comma-separated hourly variable names
 *  daily                       – comma-separated daily variable names
 *  temperature_unit            – "celsius" (default) or "fahrenheit"
 *  wind_speed_unit             – "kmh" (default), "ms", "mph", "kn"
 *  timezone                    – e.g. "Europe/Berlin" or "auto"
 *  forecast_days               – 1–16
 */
module.exports = {
  name: 'openmeteo',
  label: 'Open-Meteo (REST)',
  description: 'Free weather forecast API with no API key. Supply latitude/longitude via the `where` argument.',
  driver: 'rest',
  connection: {
    database: 'https://api.open-meteo.com/v1',
  },
  entities: [
    {
      name: '/forecast',
      columns: ['latitude', 'longitude', 'generationtime_ms', 'utc_offset_seconds', 'timezone', 'timezone_abbreviation', 'elevation', 'current_weather', 'hourly', 'hourly_units', 'daily', 'daily_units'],
      relations: [],
    },
  ],
};
