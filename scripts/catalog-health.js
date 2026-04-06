#!/usr/bin/env node
'use strict';

/**
 * Catalog health check script.
 *
 * Iterates over every REST-based catalog entry and issues a lightweight probe
 * request to verify the endpoint is still reachable and returning JSON.
 * SQL / Graph / BioCyc / KEGG entries require credentials or special drivers
 * and are skipped in this automated check.
 *
 * Results are written to --output <file> (default: catalog-health.json).
 * The script exits 0 even when some checks fail so CI records the report
 * as an artifact without blocking the workflow.
 *
 * Usage: node scripts/catalog-health.js [--output catalog-health.json]
 */

const { getCatalog } = require('../src/catalog');

const PROBE_TIMEOUT_MS = 10_000;
const SKIP_DRIVERS = new Set(['sqlite3', 'postgres', 'mysql', 'neo4j', 'arango', 'biocyc', 'mongodb',
  'openapi', 'soap', 'odata', 'thrift']);

// Parse --output flag
const outputArg = process.argv.indexOf('--output');
const outputFile = outputArg !== -1 ? process.argv[outputArg + 1] : 'catalog-health.json';

async function probe(entry) {
  if (SKIP_DRIVERS.has(entry.driver)) {
    return { status: 'skipped', reason: `driver=${entry.driver} requires credentials` };
  }

  const entity = entry.entities && entry.entities[0];
  if (!entity) {
    return { status: 'skipped', reason: 'no entities defined' };
  }

  const base = (entry.connection.database || '').replace(/\/$/, '');
  const path = entity.name.startsWith('/') ? entity.name : `/${entity.name}`;
  const url = `${base}${path}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (!res.ok) {
      return { status: 'error', httpStatus: res.status, url };
    }

    // Verify we got JSON-parseable response
    await res.json();
    return { status: 'ok', httpStatus: res.status, url };
  } catch (err) {
    return { status: 'error', error: err.message, url };
  }
}

async function main() {
  const all = getCatalog();
  const report = {
    timestamp: new Date().toISOString(),
    total: all.length,
    results: [],
  };

  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const entry of all) {
    process.stdout.write(`  ${entry.name} ... `);
    const result = await probe(entry);
    report.results.push({ name: entry.name, driver: entry.driver, ...result });

    if (result.status === 'ok') { passed++; process.stdout.write('OK\n'); }
    else if (result.status === 'skipped') { skipped++; process.stdout.write(`SKIPPED (${result.reason})\n`); }
    else { failed++; process.stdout.write(`FAIL (${result.error || result.httpStatus})\n`); }
  }

  report.summary = { passed, failed, skipped };

  const fs = require('node:fs');
  fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));

  console.log(`\nHealth check complete: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log(`Report written to ${outputFile}`);

  // Exit 0 always — failures are recorded in the artifact, not used to block CI
  process.exit(0);
}

main().catch((err) => {
  console.error('catalog-health: fatal error:', err.message);
  process.exit(1);
});
