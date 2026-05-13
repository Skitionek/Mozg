'use strict'

/**
 * SpaceX API – unofficial open-source REST API for SpaceX launch data.
 * Reference: https://github.com/r-spacex/SpaceX-API/tree/master/docs/v4
 *
 * No credentials required. All endpoints are publicly accessible.
 *
 * Relationship map:
 *  - /launches  → /rockets     (rocket ID, belongsTo)
 *  - /launches  → /launchpads  (launchpad ID, belongsTo)
 *  - /launches  → /crew        (array of crew IDs, hasMany)
 *  - /payloads  → /launches    (launch ID, belongsTo)
 *  - /crew      → /launches    (array of launch IDs, hasMany)
 *  - /capsules  → /launches    (array of launch IDs, hasMany)
 *  - /cores     → /launches    (array of launch IDs, hasMany)
 *  - /cores     → /landpads    (landpad ID per core landing, belongsTo)
 */
module.exports = {
  name: 'spacex',
  label: 'SpaceX API (REST)',
  description: 'Open-source SpaceX launch data: launches, rockets, launchpads, crew, capsules and payloads with cross-entity relations.',
  driver: 'rest',
  connection: {
    database: 'https://api.spacexdata.com/v4'
  },
  entities: [
    {
      name: '/launches',
      columns: ['id', 'name', 'date_utc', 'date_local', 'success', 'upcoming', 'details', 'flight_number', 'rocket', 'launchpad', 'cores', 'payloads', 'crew'],
      relations: [
        { entity: '/rockets', foreignKey: 'rocket', type: 'belongsTo', alias: 'rocket' },
        { entity: '/launchpads', foreignKey: 'launchpad', type: 'belongsTo', alias: 'launchpad' }
      ]
    },
    {
      name: '/rockets',
      columns: ['id', 'name', 'type', 'active', 'stages', 'boosters', 'cost_per_launch', 'success_rate_pct', 'first_flight', 'country', 'company', 'description'],
      relations: []
    },
    {
      name: '/launchpads',
      columns: ['id', 'name', 'full_name', 'status', 'region', 'timezone', 'locality', 'latitude', 'longitude', 'launch_attempts', 'launch_successes'],
      relations: []
    },
    {
      name: '/crew',
      columns: ['id', 'name', 'status', 'agency', 'image', 'wikipedia', 'launches'],
      relations: [
        { entity: '/launches', foreignKey: 'launches', type: 'hasMany', alias: 'launches' }
      ]
    },
    {
      name: '/capsules',
      columns: ['id', 'serial', 'status', 'type', 'reuse_count', 'water_landings', 'land_landings', 'last_update', 'launches'],
      relations: [
        { entity: '/launches', foreignKey: 'launches', type: 'hasMany', alias: 'launches' }
      ]
    },
    {
      name: '/payloads',
      columns: ['id', 'name', 'type', 'reused', 'launch', 'customers', 'norad_ids', 'nationalities', 'manufacturers', 'mass_kg', 'orbit'],
      relations: [
        { entity: '/launches', foreignKey: 'launch', type: 'belongsTo', alias: 'launch' }
      ]
    },
    {
      name: '/cores',
      columns: ['id', 'serial', 'block', 'status', 'reuse_count', 'rtls_attempts', 'rtls_landings', 'asds_attempts', 'asds_landings', 'last_update', 'launches'],
      relations: [
        { entity: '/launches', foreignKey: 'launches', type: 'hasMany', alias: 'launches' }
      ]
    },
    {
      name: '/landpads',
      columns: ['id', 'name', 'full_name', 'type', 'locality', 'region', 'latitude', 'longitude', 'landing_attempts', 'landing_successes', 'status'],
      relations: []
    }
  ]
}
