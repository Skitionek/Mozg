'use strict'

/**
 * A small real Thrift server for tests: HTTP transport, binary protocol, the
 * wire the graphql-mesh Thrift handler speaks.  It decodes a call message by
 * hand (no generated code, so no Thrift compiler is needed) and answers with a
 * hand-written reply.
 *
 * `methods` maps a method name to
 *   (args, fields) => { type, write }
 * where `args` is the decoded argument struct by field id, and `write(output)`
 * writes the `success` value of the given Thrift `type`.  A method that
 * returns a struct writes its fields itself.
 */

const http = require('node:http')
const thrift = require('thrift')

const { TBufferedTransport, TBinaryProtocol } = thrift
const { Type, MessageType } = thrift.Thrift

function readValue (input, ftype) {
  switch (ftype) {
    case Type.I32: return input.readI32()
    case Type.BOOL: return input.readBool()
    case Type.STRING: return input.readString()
    default: return input.skip(ftype)
  }
}

/** Handle one HTTP request body; `reply(buffer)` receives the Thrift reply. */
function handle (methods, calls, body, reply) {
  TBufferedTransport.receiver((transport) => {
    const input = new TBinaryProtocol(transport)
    const message = input.readMessageBegin()
    const args = {}
    input.readStructBegin()
    for (;;) {
      const field = input.readFieldBegin()
      if (field.ftype === Type.STOP) break
      args[field.fid] = readValue(input, field.ftype)
      input.readFieldEnd()
    }
    input.readStructEnd()
    input.readMessageEnd()
    calls.push({ method: message.fname, args })

    const method = methods[message.fname]
    const out = new TBufferedTransport(undefined, reply)
    const output = new TBinaryProtocol(out)
    output.writeMessageBegin(message.fname, MessageType.REPLY, message.rseqid)
    output.writeStructBegin(`${message.fname}_result`)
    const { type, write } = method(args)
    output.writeFieldBegin('success', type, 0)
    write(output)
    output.writeFieldEnd()
    output.writeFieldStop()
    output.writeStructEnd()
    output.writeMessageEnd()
    out.flush()
  })(body)
}

/**
 * Start a server on a free port.
 * @returns {Promise<{ port: number, calls: object[], close: () => Promise<void> }>}
 */
function startThriftServer (methods) {
  const calls = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      handle(methods, calls, Buffer.concat(chunks), (buffer) => {
        res.writeHead(200, { 'content-type': 'application/octet-stream' })
        res.end(buffer)
      })
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      port: server.address().port,
      calls,
      close: () => new Promise((done) => { server.closeAllConnections?.(); server.close(done) })
    }))
  })
}

module.exports = { startThriftServer, Type }
