"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { Kind, graphql, parse, validate } = require("graphql");
const { makeExecutableSchema } = require("@graphql-tools/schema");

// Access the private parseLiteralJSON via the exported resolver map
const { typeDefs, resolvers } = require("../src/schema");

const parseLiteral = resolvers.JSON.parseLiteral;
const schema = makeExecutableSchema({ typeDefs, resolvers });
const INDEX_HTML = path.join(__dirname, "..", "public", "index.html");

function extractFunctionSource(source, name) {
  const startToken = `function ${name}(`;
  const start = source.indexOf(startToken);
  assert.notEqual(start, -1, `${name} should exist in public/index.html`);

  let depth = 0;
  let end = -1;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  assert.notEqual(end, -1, `could not extract ${name} from public/index.html`);
  return source.slice(start, end + 1);
}

function extractConstSource(source, name) {
  const rx = new RegExp(`const ${name} = [^;]+;`);
  const match = source.match(rx);
  assert.ok(match, `${name} should exist in public/index.html`);
  return match[0];
}

function loadQueryBuilderFunction(name) {
  const source = fs.readFileSync(INDEX_HTML, "utf8");
  const context = {};
  const snippets = [];

  if (source.includes("const GQL_ENUM_FIELDS =")) {
    snippets.push(extractConstSource(source, "GQL_ENUM_FIELDS"));
  }
  if (source.includes("function isGraphQLEnumField(")) {
    snippets.push(extractFunctionSource(source, "isGraphQLEnumField"));
  }
  if (name !== "gqlValue" && source.includes("function gqlValue(")) {
    snippets.push(extractFunctionSource(source, "gqlValue"));
  }
  snippets.push(extractFunctionSource(source, name));

  vm.createContext(context);
  vm.runInContext(`${snippets.join("\n")}; this.${name} = ${name};`, context);
  return context[name];
}

describe("parseLiteralJSON", () => {
  test("parses STRING", () => {
    assert.equal(parseLiteral({ kind: Kind.STRING, value: "hello" }), "hello");
  });

  test("parses BOOLEAN true", () => {
    // In graphql-js AST, BooleanValueNode.value is an actual boolean
    assert.equal(parseLiteral({ kind: Kind.BOOLEAN, value: true }), true);
  });

  test("parses BOOLEAN false", () => {
    assert.equal(parseLiteral({ kind: Kind.BOOLEAN, value: false }), false);
  });

  test("parses INT", () => {
    assert.equal(parseLiteral({ kind: Kind.INT, value: "42" }), 42);
  });

  test("parses FLOAT", () => {
    assert.equal(parseLiteral({ kind: Kind.FLOAT, value: "3.14" }), 3.14);
  });

  test("parses NULL", () => {
    assert.equal(parseLiteral({ kind: Kind.NULL }), null);
  });

  test("parses ENUM (e.g. where: { status: ACTIVE })", () => {
    assert.equal(parseLiteral({ kind: Kind.ENUM, value: "ACTIVE" }), "ACTIVE");
  });

  test("parses LIST", () => {
    const ast = {
      kind: Kind.LIST,
      values: [
        { kind: Kind.INT, value: "1" },
        { kind: Kind.STRING, value: "two" },
      ],
    };
    assert.deepEqual(parseLiteral(ast), [1, "two"]);
  });

  test("parses nested OBJECT", () => {
    const ast = {
      kind: Kind.OBJECT,
      fields: [
        {
          name: { value: "status" },
          value: { kind: Kind.ENUM, value: "ACTIVE" },
        },
        { name: { value: "count" }, value: { kind: Kind.INT, value: "5" } },
      ],
    };
    assert.deepEqual(parseLiteral(ast), { status: "ACTIVE", count: 5 });
  });

  test("unknown kind returns null", () => {
    assert.equal(parseLiteral({ kind: "UNKNOWN_KIND" }), null);
  });
});

describe("catalog GraphQL shape", () => {
  test("catalog.entities can be queried by table name and selected columns", async () => {
    const result = await graphql({
      schema,
      source: `
        query MyQuery {
          catalog(name: "chinook") {
            name
            entities {
              Artist {
                ArtistId
                Name
              }
            }
          }
        }
      `,
    });

    assert.equal(result.errors, undefined);
    assert.equal(result.data.catalog[0].name, "chinook");
    assert.equal(result.data.catalog[0].entities.Artist.ArtistId, true);
    assert.equal(result.data.catalog[0].entities.Artist.Name, true);
  });

  test("entitiesList exposes raw names together with GraphQL-safe field names", async () => {
    const result = await graphql({
      schema,
      source: `
        query MyQuery {
          catalog(name: "jsonplaceholder") {
            entitiesList {
              name
              graphqlName
            }
          }
        }
      `,
    });

    assert.equal(result.errors, undefined);
    const posts = result.data.catalog[0].entitiesList.find(
      (entity) => entity.name === "/posts",
    );

    assert.ok(posts, "jsonplaceholder should expose the /posts entity");
    assert.equal(posts.graphqlName, "_posts");
  });
});

describe("public query builder GraphQL literals", () => {
  test("initial page setup does not access enum helpers before initialization", () => {
    const source = fs.readFileSync(INDEX_HTML, "utf8");
    const start = source.indexOf("function updateDriverUI()");
    const end = source.indexOf("async function runQuery()");
    assert.notEqual(
      start,
      -1,
      "updateDriverUI should exist in public/index.html",
    );
    assert.notEqual(end, -1, "runQuery should exist in public/index.html");

    const els = new Map();
    const makeEl = (id) => {
      if (!els.has(id)) {
        els.set(id, {
          id,
          value:
            id === "conn-driver"
              ? "sqlite3"
              : id === "q-order-dir"
                ? "asc"
                : "",
          style: {},
          placeholder: "",
          textContent: "",
          classList: { toggle() {}, add() {}, remove() {} },
          addEventListener() {},
        });
      }
      return els.get(id);
    };

    const context = {
      relations: [],
      document: { getElementById: makeEl },
      toast() {},
    };

    vm.createContext(context);
    assert.doesNotThrow(() =>
      vm.runInContext(source.slice(start, end), context),
    );
  });

  test("default sidebar query targets the seeded SQLite sample", () => {
    const source = fs.readFileSync(INDEX_HTML, "utf8");
    const start = source.indexOf("function updateDriverUI()");
    const end = source.indexOf("async function runQuery()");

    const els = new Map();
    const makeEl = (id) => {
      if (!els.has(id)) {
        els.set(id, {
          id,
          value:
            id === "conn-driver"
              ? "sqlite3"
              : id === "q-order-dir"
                ? "asc"
                : "",
          style: {},
          placeholder: "",
          textContent: "",
          classList: { toggle() {}, add() {}, remove() {} },
          addEventListener() {},
        });
      }
      return els.get(id);
    };

    const context = {
      relations: [],
      document: { getElementById: makeEl },
      toast() {},
    };

    vm.createContext(context);
    vm.runInContext(source.slice(start, end), context);

    const generated = makeEl("query-editor").value;
    assert.match(generated, /database:\s*"examples\/sample\.db"/);
    assert.match(generated, /from:\s*"users"/);
  });

  test("private catalog databases require user and password fields", () => {
    const source = fs.readFileSync(INDEX_HTML, "utf8");
    const start = source.indexOf("function updateDriverUI()");
    const end = source.indexOf("async function runQuery()");

    const els = new Map();
    const makeEl = (id) => {
      if (!els.has(id)) {
        els.set(id, {
          id,
          value:
            id === "conn-driver" ? "biocyc" : id === "q-order-dir" ? "asc" : "",
          style: {},
          placeholder: "",
          textContent: "",
          required: false,
          classList: { toggle() {}, add() {}, remove() {} },
          addEventListener() {},
        });
      }
      return els.get(id);
    };

    const context = {
      relations: [],
      selectedCatalogEntry: { driver: "biocyc", requiresCredentials: true },
      document: { getElementById: makeEl },
      toast() {},
    };

    vm.createContext(context);
    vm.runInContext(source.slice(start, end), context);
    context.updateDriverUI();

    assert.equal(makeEl("conn-user").required, true);
    assert.equal(makeEl("conn-password").required, true);
  });

  test("connToGQL emits an enum literal for driver values", () => {
    const connToGQL = loadQueryBuilderFunction("connToGQL");
    const literal = connToGQL({ driver: "sqlite3", database: ":memory:" });

    assert.match(
      literal,
      /driver:\s*sqlite3\b/,
      "driver should be emitted as an enum literal",
    );
    assert.doesNotMatch(
      literal,
      /driver:\s*"sqlite3"/,
      "driver must not be quoted",
    );

    const doc = parse(
      `{ introspect(connection: ${literal}) { tables { name } } }`,
    );
    const errors = validate(schema, doc);
    assert.equal(errors.length, 0, errors.map((e) => e.message).join("; "));
  });

  test("CodeMirror GraphQL editor explicitly enables completions", () => {
    const source = fs.readFileSync(INDEX_HTML, "utf8");

    assert.match(
      source,
      /autocompletion\s*\(/,
      "query editor should enable CodeMirror autocompletion",
    );
    assert.match(
      source,
      /startCompletion/,
      "query editor should expose an explicit completion trigger",
    );
  });
});
