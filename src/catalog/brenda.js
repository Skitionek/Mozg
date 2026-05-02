"use strict";

/**
 * BRENDA – BRaunschweig ENzyme DAtabase.
 * Reference: https://www.brenda-enzymes.org/
 * API docs:  https://www.brenda-enzymes.org/soap.php
 *
 * BRENDA's public website exposes enzyme pages at /enzyme.php, while the
 * documented programmatic API is SOAP-based and requires registration.
 * The previously advertised /rest/* JSON endpoint now returns 404.
 *
 * This catalog entry therefore uses the public enzyme page for read-only lookup
 * by EC number. Supply a where filter such as { ecno: "1.1.1.1" }.
 * The response is returned as raw HTML text with `url` and `contentType`
 * metadata so the query succeeds instead of failing on a dead REST endpoint.
 */
module.exports = {
  name: "brenda",
  label: "BRENDA Enzyme Database",
  description:
    'Public BRENDA enzyme page lookup by EC number. Use `where: { ecno: "1.1.1.1" }`. The full authenticated API is SOAP-based and documented at https://www.brenda-enzymes.org/soap.php.',
  driver: "rest",
  connection: {
    database: "https://www.brenda-enzymes.org",
  },
  entities: [
    {
      name: "/enzyme.php",
      columns: ["url", "contentType", "text"],
      relations: [],
    },
  ],
};
