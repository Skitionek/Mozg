"use strict";

const { test, describe, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const { executeQuery } = require("../src/database/drivers/rest");

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("REST driver", () => {
  test("preserves non-JSON responses as a single text row", async () => {
    globalThis.fetch = async (url) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      url: String(url),
      headers: {
        get(name) {
          return name.toLowerCase() === "content-type"
            ? "text/html; charset=UTF-8"
            : null;
        },
      },
      text: async () => "<html><body>BRENDA enzyme page</body></html>",
    });

    const result = await executeQuery({
      connection: {
        driver: "rest",
        database: "https://www.brenda-enzymes.org",
      },
      from: "/enzyme.php",
      where: { ecno: "1.1.1.1" },
      select: ["url", "contentType"],
    });

    assert.equal(result.count, 1);
    assert.equal(
      result.data[0].url,
      "https://www.brenda-enzymes.org/enzyme.php?ecno=1.1.1.1",
    );
    assert.equal(result.data[0].contentType, "text/html; charset=utf-8");
  });

  test("substitutes path parameters from where for templated REST endpoints", async () => {
    const seen = [];

    globalThis.fetch = async (url) => {
      seen.push(String(url));
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        url: String(url),
        headers: {
          get(name) {
            return name.toLowerCase() === "content-type"
              ? "application/json"
              : null;
          },
        },
        text: async () => '{"id":"WBGene00006763","label":"unc-26"}',
      };
    };

    const result = await executeQuery({
      connection: { driver: "rest", database: "https://rest.wormbase.org" },
      from: "/rest/widget/gene/{id}/overview",
      where: { id: "WBGene00006763", species: "c_elegans" },
      select: ["id"],
    });

    assert.equal(result.count, 1);
    assert.equal(result.data[0].id, "WBGene00006763");
    assert.equal(
      seen[0],
      "https://rest.wormbase.org/rest/widget/gene/WBGene00006763/overview?species=c_elegans",
    );
  });

  test("resolves templated relation paths without appending ids twice", async () => {
    const seen = [];

    globalThis.fetch = async (url) => {
      seen.push(String(url));
      const body =
        seen.length === 1
          ? '[{"name":"WBGene00006763"}]'
          : '[{"phenotype":"uncoordinated movement"}]';

      return {
        ok: true,
        status: 200,
        statusText: "OK",
        url: String(url),
        headers: {
          get(name) {
            return name.toLowerCase() === "content-type"
              ? "application/json"
              : null;
          },
        },
        text: async () => body,
      };
    };

    const result = await executeQuery({
      connection: { driver: "rest", database: "https://rest.wormbase.org" },
      from: "/genes",
      relations: [
        {
          entity: "/rest/widget/gene/{id}/phenotype",
          foreignKey: "name",
          type: "hasMany",
          alias: "phenotypes",
        },
      ],
    });

    assert.equal(
      result.data[0].phenotypes[0].phenotype,
      "uncoordinated movement",
    );
    assert.equal(
      seen[1],
      "https://rest.wormbase.org/rest/widget/gene/WBGene00006763/phenotype",
    );
  });

  test("fans out templated relations from nested array identifiers", async () => {
    const seen = [];

    globalThis.fetch = async (url) => {
      seen.push(String(url));
      let body = "{}";

      if (String(url).endsWith("/entry/1TUP")) {
        body = JSON.stringify({
          entry: { id: "1TUP" },
          rcsb_entry_container_identifiers: {
            entry_id: "1TUP",
            polymer_entity_ids: ["1", "2"],
          },
        });
      } else if (String(url).endsWith("/polymer_entity/1TUP/1")) {
        body = '[{"entity_id":"1","name":"DNA chain"}]';
      } else if (String(url).endsWith("/polymer_entity/1TUP/2")) {
        body = '[{"entity_id":"2","name":"p53 chain"}]';
      }

      return {
        ok: true,
        status: 200,
        statusText: "OK",
        url: String(url),
        headers: {
          get(name) {
            return name.toLowerCase() === "content-type"
              ? "application/json"
              : null;
          },
        },
        text: async () => body,
      };
    };

    const result = await executeQuery({
      connection: {
        driver: "rest",
        database: "https://data.rcsb.org/rest/v1/core",
      },
      from: "/entry/{id}",
      where: { id: "1TUP" },
      relations: [
        {
          entity: "/polymer_entity/{entry_id}/{entity_id}",
          localKey: "rcsb_entry_container_identifiers.polymer_entity_ids",
          foreignKey: "entity_id",
          type: "hasMany",
          alias: "polymerEntities",
        },
      ],
    });

    assert.equal(result.data[0].polymerEntities.length, 2);
    assert.equal(result.data[0].polymerEntities[0].entity_id, "1");
    assert.equal(result.data[0].polymerEntities[1].entity_id, "2");
    assert.ok(
      seen.includes("https://data.rcsb.org/rest/v1/core/polymer_entity/1TUP/1"),
    );
    assert.ok(
      seen.includes("https://data.rcsb.org/rest/v1/core/polymer_entity/1TUP/2"),
    );
  });
});
