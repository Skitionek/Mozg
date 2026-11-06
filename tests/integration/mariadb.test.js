'use strict'

/**
 * The same connector (driver `mysql`) against MariaDB, the Helm chart's
 * default MySQL server.  Runs when MOZG_IT_MARIADB_URL is set, e.g.
 *   mysql://root@127.0.0.1:3307/mozg_it
 * (password, if the server needs one, in MOZG_IT_MARIADB_PASSWORD).
 */

require('./mysql-protocol').runMysqlProtocolSuite('mariadb')
