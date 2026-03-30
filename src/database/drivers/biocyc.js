'use strict';

// BioCyc / Pathway Tools web-service connector.
//
// Connection parameters:
//   database  – organism database code, e.g. "ECOLI", "META", "HUMAN", "ARA"
//   host      – optional; defaults to websvc.biocyc.org (cloud) or a local
//               Pathway Tools server (e.g. localhost:1555)
//   scheme    – "https" (default) or "http" (for local PTools)
//   port      – optional; overrides scheme default
//   user      – BioCyc account e-mail (optional for public read access)
//   password  – BioCyc account password (optional)
//
// Supported entity types (from):
//   genes, compounds, reactions, pathways, proteins, rna, organisms

const BIOCYC_CLASSES = ['genes', 'compounds', 'reactions', 'pathways', 'proteins', 'rna', 'organisms'];

// Map entity names → BioCyc class names
const CLASS_MAP = {
  genes: 'Gene',
  compounds: 'Compound',
  reactions: 'Reaction',
  pathways: 'Pathway',
  proteins: 'Protein',
  rna: 'RNA',
  organisms: 'Organism',
};

// Session cookie cache keyed by user e-mail
const sessionCache = new Map();

function baseUrl(config) {
  if (config.host) {
    const scheme = config.scheme || 'http';
    const port = config.port ? `:${config.port}` : '';
    return `${scheme}://${config.host}${port}`;
  }
  return 'https://websvc.biocyc.org';
}

async function authenticate(config) {
  if (!config.user || !config.password) return null;
  if (sessionCache.has(config.user)) return sessionCache.get(config.user);

  const body = new URLSearchParams({ email: config.user, password: config.password });
  const res = await fetch(`${baseUrl(config)}/credentials/login/`, {
    method: 'POST',
    body,
    redirect: 'manual',
  });

  const raw = res.headers.get('set-cookie') || '';
  // Extract the session cookie value (typically "BioCycSessionID=...")
  const cookie = raw.split(';')[0] || null;
  if (cookie) sessionCache.set(config.user, cookie);
  return cookie;
}

async function biocycGet(path, config) {
  const cookie = await authenticate(config);
  const headers = { Accept: 'text/plain' };
  if (cookie) headers['Cookie'] = cookie;

  const url = `${baseUrl(config)}${path}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`BioCyc HTTP ${res.status}: ${res.statusText} — ${url}`);
  return res.text();
}

// Parse BioCyc attribute-value (AV) text format into plain objects.
function parseAV(text) {
  const records = [];
  let current = null;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line === '-------') {
      if (current) { records.push(current); current = null; }
      continue;
    }
    if (line.startsWith('FRAME:')) {
      current = { _id: line.slice(6).trim() };
    } else if (current) {
      const colon = line.indexOf(':');
      if (colon === -1) continue;
      const key = line.slice(0, colon).trim().toLowerCase().replace(/-/g, '_');
      const val = line.slice(colon + 1).trim();
      if (current[key] === undefined) {
        current[key] = val;
      } else if (Array.isArray(current[key])) {
        current[key].push(val);
      } else {
        current[key] = [current[key], val];
      }
    }
  }

  if (current) records.push(current);
  return records;
}

async function executeQuery(input) {
  const { connection, from, where, limit, offset, relations } = input;
  const orgId = connection.database;
  const className = CLASS_MAP[from.toLowerCase()] || from;

  const text = await biocycGet(`/${orgId}/class-instances?o=${encodeURIComponent(className)}&detail=low`, connection);
  let rows = parseAV(text);

  // Client-side filtering
  if (where && Object.keys(where).length > 0) {
    rows = rows.filter((row) =>
      Object.entries(where).every(([k, v]) => String(row[k.toLowerCase()] ?? '') === String(v))
    );
  }

  if (offset != null) rows = rows.slice(offset);
  if (limit != null) rows = rows.slice(0, limit);

  // Resolve relations: fetch full detail for related frames
  if (relations && relations.length > 0) {
    for (const row of rows) {
      for (const rel of relations) {
        const relKey = rel.alias || rel.entity;
        const ids = [].concat(row[rel.foreignKey] || []).filter(Boolean);
        if (!ids.length) { row[relKey] = rel.type === 'hasMany' ? [] : null; continue; }

        const relClass = CLASS_MAP[rel.entity.toLowerCase()] || rel.entity;
        const relRows = [];
        for (const id of ids) {
          try {
            const t = await biocycGet(`/${orgId}/class-instances?o=${encodeURIComponent(relClass)}&detail=low`, connection);
            const parsed = parseAV(t).filter((r) => r._id === id);
            relRows.push(...parsed);
          } catch { /* skip inaccessible frames */ }
        }
        row[relKey] = rel.type === 'hasMany' ? relRows : (relRows[0] ?? null);
      }
    }
  }

  return { data: rows, count: rows.length };
}

async function introspect(_connection) {
  // BioCyc has a well-known fixed schema; return it statically.
  const tables = BIOCYC_CLASSES.map((name) => ({
    name,
    columns: [
      { name: '_id',     type: 'String',  nullable: false, defaultValue: null, isPrimaryKey: true  },
      { name: 'name',    type: 'String',  nullable: true,  defaultValue: null, isPrimaryKey: false },
      { name: 'types',   type: 'String',  nullable: true,  defaultValue: null, isPrimaryKey: false },
      ...extraColumns(name),
    ],
  }));
  return { tables };
}

function extraColumns(entity) {
  const map = {
    genes:     [{ name: 'left_end_position',    type: 'Integer', nullable: true, defaultValue: null, isPrimaryKey: false },
                { name: 'right_end_position',   type: 'Integer', nullable: true, defaultValue: null, isPrimaryKey: false },
                { name: 'transcription_direction', type: 'String', nullable: true, defaultValue: null, isPrimaryKey: false }],
    compounds: [{ name: 'molecular_weight',     type: 'Float',   nullable: true, defaultValue: null, isPrimaryKey: false },
                { name: 'formula',              type: 'String',  nullable: true, defaultValue: null, isPrimaryKey: false },
                { name: 'inchi',                type: 'String',  nullable: true, defaultValue: null, isPrimaryKey: false }],
    reactions: [{ name: 'ec_number',            type: 'String',  nullable: true, defaultValue: null, isPrimaryKey: false },
                { name: 'enzymatic_reaction',   type: 'String',  nullable: true, defaultValue: null, isPrimaryKey: false }],
    pathways:  [{ name: 'taxonomic_range',      type: 'String',  nullable: true, defaultValue: null, isPrimaryKey: false },
                { name: 'reaction_list',        type: 'String',  nullable: true, defaultValue: null, isPrimaryKey: false }],
  };
  return map[entity] || [];
}

module.exports = { executeQuery, introspect };
