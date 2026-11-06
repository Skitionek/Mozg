'use strict'

/**
 * BioCyc driver against the documented Pathway Tools `apixml` responses.
 * The fixture copies the structure of a real
 * `apixml?fn=get-class-all-instances&id=ECOLI:Pathways&detail=low` answer.
 */

const { test, describe, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const http = require('../src/database/http')
const biocyc = require('../src/database/drivers/biocyc')

const PATHWAYS = `<?xml version="1.0" encoding="iso-8859-1"?>
<ptools-xml ptools-version='30.0'>
  <metadata><num_results>2</num_results></metadata>
  <Pathway ID='ECOLI:PWY0-301' orgid='ECOLI' frameid='PWY0-301' detail='low'>
    <parent><Pathway resource='getxml?ECOLI:Ascorbate-Degradation' orgid='ECOLI' frameid='Ascorbate-Degradation' class='true'/></parent>
    <synonym datatype='string'>ascorbic acid degradation I</synonym>
    <common-name datatype='string'>L-ascorbate degradation I</common-name>
    <reaction-list>
      <Reaction resource='getxml?ECOLI:RXN0-2461' orgid='ECOLI' frameid='RXN0-2461'/>
      <Reaction resource='getxml?ECOLI:RXN0-705' orgid='ECOLI' frameid='RXN0-705'/>
    </reaction-list>
  </Pathway>
  <Pathway ID='ECOLI:PWY3O-4106' orgid='ECOLI' frameid='PWY3O-4106' detail='low'>
    <common-name datatype='string'>NAD salvage pathway IV</common-name>
    <reaction-list><Reaction resource='getxml?ECOLI:2.7.7.1-RXN' orgid='ECOLI' frameid='2.7.7.1-RXN'/></reaction-list>
  </Pathway>
</ptools-xml>`

const REACTIONS = `<?xml version="1.0"?>
<ptools-xml>
  <Reaction ID='ECOLI:RXN0-2461' frameid='RXN0-2461'><common-name datatype='string'>L-ascorbate 6-phosphate lactonase</common-name><ec-number datatype='string'>EC-3.1.1.-</ec-number></Reaction>
  <Reaction ID='ECOLI:RXN0-705' frameid='RXN0-705'><ec-number datatype='string'>EC-4.1.1.85</ec-number></Reaction>
  <Reaction ID='ECOLI:2.7.7.1-RXN' frameid='2.7.7.1-RXN'><ec-number datatype='string'>EC-2.7.7.1</ec-number></Reaction>
</ptools-xml>`

let requests
let original
let status

beforeEach(() => {
  http.reset()
  requests = []
  status = 200
  original = globalThis.fetch
  globalThis.fetch = async (url) => {
    requests.push(String(url))
    const body = String(url).includes('Pathways') ? PATHWAYS : REACTIONS
    return { ok: status === 200, status, statusText: '', headers: { get: () => 'text/xml' }, text: async () => (status === 200 ? body : '') }
  }
})

afterEach(() => { globalThis.fetch = original })

// Distinct database codes per test keep the driver's short listing cache out of the way.
let n = 0
const connection = () => ({ driver: 'biocyc', database: `ECOLI${n++}` })

describe('biocyc driver', () => {
  test('lists a class through the documented apixml endpoint', async () => {
    const conn = connection()
    const { data } = await biocyc.executeQuery({ connection: conn, from: 'pathways' })
    assert.match(requests[0], new RegExp(`^https://websvc\\.biocyc\\.org/apixml\\?fn=get-class-all-instances&id=${conn.database}%3APathways&detail=low$`))
    assert.deepEqual(data[0], {
      _id: 'PWY0-301',
      parent: ['Ascorbate-Degradation'],
      synonym: ['ascorbic acid degradation I'],
      common_name: 'L-ascorbate degradation I',
      reaction_list: ['RXN0-2461', 'RXN0-705'],
      name: 'L-ascorbate degradation I',
      types: ['Ascorbate-Degradation']
    })
  })

  test('filters, orders, pages and selects client-side', async () => {
    const { data } = await biocyc.executeQuery({ connection: connection(), from: 'pathways', orderBy: 'name', select: ['_id', 'name'], limit: 1 })
    assert.deepEqual(data, [{ _id: 'PWY0-301', name: 'L-ascorbate degradation I' }])
    const { data: found } = await biocyc.executeQuery({ connection: connection(), from: 'pathways', where: { reaction_list: '2.7.7.1-RXN' } })
    assert.deepEqual(found.map((r) => r._id), ['PWY3O-4106'])
  })

  test('follows frame references with one listing of the related class', async () => {
    const { data } = await biocyc.executeQuery({
      connection: connection(),
      from: 'pathways',
      relations: [{ entity: 'reactions', foreignKey: 'reaction_list', type: 'hasMany', alias: 'reactions', select: ['_id', 'ec_number'] }]
    })
    assert.deepEqual(data[0].reactions, [{ _id: 'RXN0-2461', ec_number: 'EC-3.1.1.-' }, { _id: 'RXN0-705', ec_number: 'EC-4.1.1.85' }])
    assert.equal(requests.filter((u) => u.includes('Reactions')).length, 1, 'one request for the related class, not one per id')
  })

  test('an account-required redirect becomes a message saying how to sign in', async () => {
    status = 307
    await assert.rejects(biocyc.executeQuery({ connection: connection(), from: 'genes' }), /BioCyc requires an account for this request — pass your BioCyc login/)
  })

  test('needs an organism database code', async () => {
    await assert.rejects(biocyc.executeQuery({ connection: { driver: 'biocyc' }, from: 'genes' }), /organism database code/)
  })

  test('introspection describes the shared Pathway Tools schema without a request', async () => {
    const { tables } = await biocyc.introspect({})
    assert.ok(tables.find((t) => t.name === 'pathways').columns.some((c) => c.name === 'reaction_list'))
    assert.equal(requests.length, 0)
  })
})
