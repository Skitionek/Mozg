'use strict'

const { Readable } = require('node:stream')
const { RdfXmlParser } = require('rdfxml-streaming-parser')

function parseRdfXml (content) {
  return new Promise((resolve, reject) => {
    const quads = []
    const parser = new RdfXmlParser()
    parser.on('data', q => quads.push(q))
    parser.on('error', reject)
    parser.on('end', () => resolve(quads))
    Readable.from([content]).pipe(parser)
  })
}

module.exports = { parseRdfXml }
