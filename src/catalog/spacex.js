'use strict';

/**
 * SpaceX API – unofficial open-source REST API for SpaceX launch data.
 * Reference: https://github.com/r-spacex/SpaceX-API/tree/master/docs/v4
 *
 * No credentials required. All endpoints are publicly accessible.
 *
 * Relationship notes:
 *  - Each launch has a `rocket` field holding a rocket ID. The REST driver
 *    resolves this by fetching /rockets/{id}.
 *  - Each launch has a `launchpad` field holding a launchpad ID → /launchpads/{id}.
 *  - Each payload has a `launch` field holding a launch ID → /launches/{id}.
 */
module.exports = {
  name: 'spacex',
  label: 'SpaceX API (REST)',
  description: 'Open-source SpaceX launch data: launches, rockets, launchpads, crew, capsules and payloads with cross-entity relations.',
  driver: 'rest',
  connection: {
    database: 'https://api.spacexdata.com/v4',
  },
  entities: [
    {
      name: '/launches',
      columns: ['id', 'name', 'date_utc', 'date_local', 'success', 'upcoming', 'details', 'flight_number', 'rocket', 'launchpad', 'cores', 'payloads', 'crew'],
      relations: [
        { entity: '/rockets', foreignKey: 'rocket', type: 'belongsTo', alias: 'rocketData' },
        { entity: '/launchpads', foreignKey: 'launchpad', type: 'belongsTo', alias: 'launchpadData' },
      ],
    },
    {
      name: '/rockets',
      columns: ['id', 'name', 'type', 'active', 'stages', 'boosters', 'cost_per_launch', 'success_rate_pct', 'first_flight', 'country', 'company', 'description'],
      relations: [],
    },
    {
      name: '/launchpads',
      columns: ['id', 'name', 'full_name', 'status', 'region', 'timezone', 'locality', 'latitude', 'longitude', 'launch_attempts', 'launch_successes'],
      relations: [],
    },
    {
      name: '/crew',
      columns: ['id', 'name', 'status', 'agency', 'image', 'wikipedia', 'launches'],
      relations: [],
    },
    {
      name: '/capsules',
      columns: ['id', 'serial', 'status', 'type', 'reuse_count', 'water_landings', 'land_landings', 'last_update', 'launches'],
      relations: [],
    },
    {
      name: '/payloads',
      columns: ['id', 'name', 'type', 'reused', 'launch', 'customers', 'norad_ids', 'nationalities', 'manufacturers', 'mass_kg', 'orbit'],
      relations: [
        { entity: '/launches', foreignKey: 'launch', type: 'belongsTo', alias: 'launchData' },
      ],
    },
    {
      name: '/cores',
      columns: ['id', 'serial', 'block', 'status', 'reuse_count', 'rtls_attempts', 'rtls_landings', 'asds_attempts', 'asds_landings', 'last_update', 'launches'],
      relations: [],
    },
    {
      name: '/landpads',
      columns: ['id', 'name', 'full_name', 'type', 'locality', 'region', 'latitude', 'longitude', 'landing_attempts', 'landing_successes', 'status'],
      relations: [],
    },
  ],
};
