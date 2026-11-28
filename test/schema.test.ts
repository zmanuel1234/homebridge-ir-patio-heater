import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

interface Field {
  type?: string;
  'x-schema-form'?: { type?: string };
}
const schema = JSON.parse(readFileSync(new URL('../config.schema.json', import.meta.url), 'utf8')) as {
  schema: { properties: { heaters: { items: { properties: Record<string, Field> } } } };
};

test('settings screen: no <...> in labels, which the screen renders as markup', () => {
  const texts: string[] = [];
  const walk = (o: unknown) => {
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

test('settings screen: number fields are number boxes, not sliders', () => {
  // The settings screen draws an integer with a minimum (and on some versions
  // without a maximum too) as a range slider; exact values are hard to set.
  const fields = Object.entries(schema.schema.properties.heaters.items.properties)
    .filter(([, v]) => v.type === 'integer' || v.type === 'number');
  assert.ok(fields.length > 0);
  for (const [key, v] of fields) {
    assert.equal(v['x-schema-form'] && v['x-schema-form'].type, 'number', key);
  }
});
