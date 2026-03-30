'use strict';

const { Parser } = require('n3');

function parseTurtle(content) {
  return new Promise((resolve, reject) => {
    const quads = [];
    const parser = new Parser();
    parser.parse(content, (err, quad) => {
      if (err) return reject(err);
      if (quad) quads.push(quad);
      else resolve(quads);
    });
  });
}

module.exports = { parseTurtle };
