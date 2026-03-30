'use strict';

/**
 * Chinook – a widely-used sample database modelling a digital music store.
 * Schema reference: https://github.com/lerocha/chinook-database
 *
 * The user must supply the path to their own Chinook SQLite file.
 */
module.exports = {
  name: 'chinook',
  label: 'Chinook (SQLite)',
  description: 'Sample music-store database with artists, albums, tracks, invoices and customers.',
  driver: 'sqlite3',
  connection: {
    database: 'chinook.db',
  },
  entities: [
    {
      name: 'Artist',
      columns: ['ArtistId', 'Name'],
      relations: [
        { entity: 'Album', foreignKey: 'ArtistId', type: 'hasMany', alias: 'albums' },
      ],
    },
    {
      name: 'Album',
      columns: ['AlbumId', 'Title', 'ArtistId'],
      relations: [
        { entity: 'Artist', foreignKey: 'ArtistId', localKey: 'ArtistId', type: 'belongsTo', alias: 'artist' },
        { entity: 'Track', foreignKey: 'AlbumId', type: 'hasMany', alias: 'tracks' },
      ],
    },
    {
      name: 'Track',
      columns: ['TrackId', 'Name', 'AlbumId', 'MediaTypeId', 'GenreId', 'Milliseconds', 'UnitPrice'],
      relations: [
        { entity: 'Album', foreignKey: 'AlbumId', localKey: 'AlbumId', type: 'belongsTo', alias: 'album' },
        { entity: 'Genre', foreignKey: 'GenreId', localKey: 'GenreId', type: 'belongsTo', alias: 'genre' },
        { entity: 'MediaType', foreignKey: 'MediaTypeId', localKey: 'MediaTypeId', type: 'belongsTo', alias: 'mediaType' },
        { entity: 'InvoiceLine', foreignKey: 'TrackId', type: 'hasMany', alias: 'invoiceLines' },
      ],
    },
    {
      name: 'Genre',
      columns: ['GenreId', 'Name'],
      relations: [
        { entity: 'Track', foreignKey: 'GenreId', type: 'hasMany', alias: 'tracks' },
      ],
    },
    {
      name: 'MediaType',
      columns: ['MediaTypeId', 'Name'],
      relations: [
        { entity: 'Track', foreignKey: 'MediaTypeId', type: 'hasMany', alias: 'tracks' },
      ],
    },
    {
      name: 'Customer',
      columns: ['CustomerId', 'FirstName', 'LastName', 'Email', 'Country', 'SupportRepId'],
      relations: [
        { entity: 'Invoice', foreignKey: 'CustomerId', type: 'hasMany', alias: 'invoices' },
        { entity: 'Employee', foreignKey: 'SupportRepId', localKey: 'SupportRepId', type: 'belongsTo', alias: 'supportRep' },
      ],
    },
    {
      name: 'Invoice',
      columns: ['InvoiceId', 'CustomerId', 'InvoiceDate', 'Total'],
      relations: [
        { entity: 'Customer', foreignKey: 'CustomerId', localKey: 'CustomerId', type: 'belongsTo', alias: 'customer' },
        { entity: 'InvoiceLine', foreignKey: 'InvoiceId', type: 'hasMany', alias: 'lines' },
      ],
    },
    {
      name: 'InvoiceLine',
      columns: ['InvoiceLineId', 'InvoiceId', 'TrackId', 'UnitPrice', 'Quantity'],
      relations: [
        { entity: 'Invoice', foreignKey: 'InvoiceId', localKey: 'InvoiceId', type: 'belongsTo', alias: 'invoice' },
        { entity: 'Track', foreignKey: 'TrackId', localKey: 'TrackId', type: 'belongsTo', alias: 'track' },
      ],
    },
    {
      name: 'Employee',
      columns: ['EmployeeId', 'LastName', 'FirstName', 'Title', 'ReportsTo', 'Email'],
      relations: [
        { entity: 'Customer', foreignKey: 'SupportRepId', localKey: 'EmployeeId', type: 'hasMany', alias: 'customers' },
        { entity: 'Employee', foreignKey: 'ReportsTo', localKey: 'EmployeeId', type: 'hasMany', alias: 'reports' },
      ],
    },
    {
      name: 'Playlist',
      columns: ['PlaylistId', 'Name'],
      relations: [
        { entity: 'PlaylistTrack', foreignKey: 'PlaylistId', type: 'hasMany', alias: 'playlistTracks' },
      ],
    },
    {
      name: 'PlaylistTrack',
      columns: ['PlaylistId', 'TrackId'],
      relations: [
        { entity: 'Track', foreignKey: 'TrackId', localKey: 'TrackId', type: 'belongsTo', alias: 'track' },
      ],
    },
  ],
};
