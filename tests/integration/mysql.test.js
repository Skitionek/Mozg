'use strict'

/**
 * MySQL connector (knex over mysql2) against a real Oracle MySQL server.
 * Runs when MOZG_IT_MYSQL_URL is set, e.g.
 *   mysql://root@127.0.0.1:3306/mozg_it
 * (password, if the server needs one, in MOZG_IT_MYSQL_PASSWORD).  The server
 * runs with its default login method, caching_sha2_password; MySQL 9 has no
 * other (docs/connectors.md, finding 2).
 */

require('./mysql-protocol').runMysqlProtocolSuite('mysql')
