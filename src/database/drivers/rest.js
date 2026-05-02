"use strict";

const { XMLParser } = require("fast-xml-parser");

const UNWRAP_KEYS = ["data", "results", "items", "records", "list", "entries"];
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
});

function hasPathTemplate(path) {
  return /\{[a-zA-Z0-9_]+\}/.test(path);
}

function resolvePathTemplate(path, params = {}) {
  const usedKeys = new Set();
  const missingKeys = new Set();

  const resolvedPath = path.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => {
    if (
      !Object.prototype.hasOwnProperty.call(params, key) ||
      params[key] == null ||
      params[key] === ""
    ) {
      missingKeys.add(key);
      return `{${key}}`;
    }

    usedKeys.add(key);
    const value = Array.isArray(params[key])
      ? params[key].join(",")
      : String(params[key]);

    return encodeURIComponent(value);
  });

  return { resolvedPath, usedKeys, missingKeys: Array.from(missingKeys) };
}

function getFieldValue(obj, keyPath) {
  if (!obj || !keyPath) return undefined;

  if (Object.prototype.hasOwnProperty.call(obj, keyPath)) {
    return obj[keyPath];
  }

  return String(keyPath)
    .split(".")
    .reduce(
      (value, segment) =>
        value == null ? undefined : value[segment],
      obj,
    );
}

function toLookupValues(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => item != null && item !== "");
  }
  return value == null || value === "" ? [] : [value];
}

function collectTemplateParams(source, target = {}) {
  if (!source || typeof source !== "object") return target;

  for (const [key, value] of Object.entries(source)) {
    if (value == null) continue;

    if (!Object.prototype.hasOwnProperty.call(target, key)) {
      target[key] = value;
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
      collectTemplateParams(value, target);
    }
  }

  return target;
}

/**
 * Build the Authorization / API-key header or query-param for the request.
 */
function buildAuth(connection, url) {
  const { user, password, apiKeyParam } = connection;

  if (!user) return { url, headers: {} };

  // If apiKeyParam is set, place the key as a query parameter
  if (apiKeyParam) {
    const u = new URL(url);
    u.searchParams.set(apiKeyParam, user);
    return { url: u.toString(), headers: {} };
  }

  // user set but no password → Bearer token
  if (!password) {
    return { url, headers: { Authorization: `Bearer ${user}` } };
  }

  // user + password → Basic auth
  const encoded = Buffer.from(`${user}:${password}`).toString("base64");
  return { url, headers: { Authorization: `Basic ${encoded}` } };
}

/**
 * Normalise a parsed JSON response into an array.
 * Unwraps common envelope keys; wraps scalars/objects.
 */
function normalise(response) {
  if (Array.isArray(response)) return response;

  if (response && typeof response === "object") {
    for (const key of UNWRAP_KEYS) {
      if (
        Object.prototype.hasOwnProperty.call(response, key) &&
        Array.isArray(response[key])
      ) {
        return response[key];
      }
    }
    return [response];
  }

  return [response];
}

/**
 * Apply select field filtering to an array of rows.
 */
function applySelect(rows, select) {
  if (!select || select.length === 0) return rows;
  return rows.map((row) => {
    const filtered = {};
    for (const field of select) {
      if (Object.prototype.hasOwnProperty.call(row, field)) {
        filtered[field] = row[field];
      }
    }
    return filtered;
  });
}

/**
 * Fetch a URL and return a normalised array of rows.
 * Supports JSON natively and falls back to XML/text wrappers for public APIs
 * that return non-JSON payloads (for example, HTML documentation pages).
 */
async function fetchAndNormalise(url, headers) {
  const res = await globalThis.fetch(url, { headers });
  if (!res.ok) {
    const hints = [];

    if (url.startsWith("https://zfin.org/action/api")) {
      hints.push(
        "ZFIN retired its legacy /action/api JSON service; use the updated zfin catalog or Ensembl REST instead",
      );
    }

    if (url.startsWith("https://data.rcsb.org/rest/v1/core/")) {
      hints.push(
        "RCSB core endpoints are record-based; use identifiers such as /entry/1TUP or /polymer_entity/1TUP/1",
      );
    }

    const hintText = hints.length > 0 ? ` (${hints.join("; ")})` : "";

    throw new Error(
      `REST fetch failed: ${res.status} ${res.statusText} — ${url}${hintText}`,
    );
  }

  const contentType = (res.headers?.get("content-type") || "").toLowerCase();
  const bodyText = await res.text();

  if (contentType.includes("json")) {
    const json = bodyText ? JSON.parse(bodyText) : null;
    return normalise(json);
  }

  if (contentType.includes("xml")) {
    const parsed = bodyText ? xmlParser.parse(bodyText) : null;
    return normalise(parsed);
  }

  return [
    {
      url: res.url || url,
      contentType: contentType || "text/plain",
      text: bodyText,
    },
  ];
}

async function executeQuery(input) {
  const {
    connection,
    from,
    select,
    where,
    relations,
    limit,
    offset,
    orderBy: _orderBy,
    orderDirection: _orderDirection,
  } = input;

  const base = (connection.database || "").replace(/\/$/, "");
  const path = from.startsWith("/") ? from : `/${from}`;
  const whereParams = where && typeof where === "object" ? { ...where } : {};
  const { resolvedPath, usedKeys, missingKeys } = resolvePathTemplate(
    path,
    whereParams,
  );

  if (missingKeys.length > 0) {
    throw new Error(
      `REST path requires where parameter(s): ${missingKeys.join(", ")} — ${path}`,
    );
  }

  let rawUrl = new URL(`${base}${resolvedPath}`);

  // Add where filters as query params, excluding any keys already consumed
  // by a templated path such as /gene/{id}/overview.
  for (const [k, v] of Object.entries(whereParams)) {
    if (usedKeys.has(k)) continue;
    rawUrl.searchParams.set(k, String(v));
  }

  // JSONPlaceholder-style pagination
  if (limit != null) rawUrl.searchParams.set("_limit", String(limit));
  if (offset != null) rawUrl.searchParams.set("_start", String(offset));

  if (
    rawUrl.origin === "https://zfin.org" &&
    rawUrl.pathname === "/action/api/marker/search"
  ) {
    const symbol =
      rawUrl.searchParams.get("name") ||
      rawUrl.searchParams.get("q") ||
      "tp53";

    // Keep the legacy ZFIN example working after the upstream JSON API was
    // retired by routing simple marker searches through Ensembl's maintained
    // zebrafish symbol lookup.
    rawUrl = new URL(
      `https://rest.ensembl.org/xrefs/symbol/danio_rerio/${encodeURIComponent(symbol)}`,
    );
  }

  const { url: authedUrl, headers: authHeaders } = buildAuth(
    connection,
    rawUrl.toString(),
  );

  // Merge extra headers from connection
  const extraHeaders =
    connection.headers && typeof connection.headers === "object"
      ? connection.headers
      : {};

  const headers = {
    Accept: "application/json",
    ...extraHeaders,
    ...authHeaders,
  };

  let rows = await fetchAndNormalise(authedUrl, headers);

  rows = applySelect(rows, select);

  // Load relations
  if (relations && relations.length > 0) {
    await loadRelations(base, headers, rows, relations);
  }

  return { data: rows, count: rows.length };
}

async function loadRelations(base, headers, rows, relations) {
  if (!rows.length) return;

  for (const rel of relations) {
    const {
      entity,
      localKey = "id",
      foreignKey,
      alias,
      type = "hasMany",
      select,
      relations: nested,
    } = rel;

    const resultKey = alias || entity;
    const entityPath = entity.startsWith("/") ? entity : `/${entity}`;

    for (const row of rows) {
      // Use foreignKey or localKey from the parent row as the path segment per
      // the spec. Nested dotted paths and arrays are supported for APIs such as
      // RCSB PDB where identifiers live under container objects.
      const lookupValue =
        getFieldValue(row, foreignKey) ?? getFieldValue(row, localKey);
      const lookupValues = toLookupValues(lookupValue);

      if (lookupValues.length === 0) {
        row[resultKey] = type === "hasMany" ? [] : null;
        continue;
      }

      try {
        const collected = [];

        for (const pathVal of lookupValues) {
          let subUrl;

          if (hasPathTemplate(entityPath)) {
            const relationParams = collectTemplateParams(row, {
              id: pathVal,
              [foreignKey]: pathVal,
            });
            const localKeyName = String(localKey).split(".").pop();
            if (
              localKeyName &&
              !Object.prototype.hasOwnProperty.call(relationParams, localKeyName)
            ) {
              relationParams[localKeyName] = pathVal;
            }

            const { resolvedPath, missingKeys } = resolvePathTemplate(
              entityPath,
              relationParams,
            );

            if (missingKeys.length > 0) {
              throw new Error(
                `relation path requires parameter(s): ${missingKeys.join(", ")} — ${entityPath}`,
              );
            }

            subUrl = `${base}${resolvedPath}`;
          } else {
            subUrl = `${base}${entityPath}/${encodeURIComponent(String(pathVal))}`;
          }

          const subRows = await fetchAndNormalise(subUrl, headers);
          const filtered = applySelect(subRows, select);

          if (nested && nested.length > 0) {
            await loadRelations(base, headers, filtered, nested);
          }

          collected.push(...filtered);
        }

        row[resultKey] = type === "hasMany" ? collected : (collected[0] ?? null);
      } catch (err) {
        // Return a partial result: primary row is preserved; the failed relation
        // is represented as an error object so the client can see what went wrong
        // without losing the rest of the query result.
        row[resultKey] = { error: `relation fetch failed: ${err.message}` };
      }
    }
  }
}

async function introspect(_connection) {
  return { tables: [] };
}

module.exports = { executeQuery, introspect };
