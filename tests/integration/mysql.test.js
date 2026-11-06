'use strict'

/**
 * MySQL connector (graphql-mesh MySQL handler) against a real Oracle MySQL
 * server.  Runs when MOZG_IT_MYSQL_URL is set, e.g.
 *   mysql://root@127.0.0.1:3306/mozg_it
 * (password, if the server needs one, in MOZG_IT_MYSQL_PASSWORD).  MySQL 8.4
 * needs mysql_native_password switched on; 9.x cannot be reached at all
 * (docs/connectors.md, finding 2).
 */

require('./mysql-protocol').runMysqlProtocolSuite('mysql')
