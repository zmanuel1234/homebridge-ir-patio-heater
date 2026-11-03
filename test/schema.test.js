'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../config.schema.json');

test('settings screen: no <...> in labels, which the screen renders as markup', () => {
  const texts = [];
  const walk = (o) => {
    if (!o || typeof o !== 'object') {
      return;
    }
    for (const [k, v] of Object.entries(o)) {
      if ((k === 'title' || k === 'description' || k === 'headerDisplay' || k === 'footerDisplay') && typeof v === 'string') {
        texts.push(v);
      } else {
        walk(v);
      }
    }
  };
  walk(schema);
  for (const t of texts) {
    assert.doesNotMatch(t, /<[a-z][^>]*>/i, t);
  }
});
