const { create } = require('xmlbuilder2');

function formatValue(value) {
  if (value === null || value === undefined) return null;
  const t = typeof value;
  if (t === 'string') return { tag: 'string', text: value };
  if (t === 'number') return { tag: 'number', text: String(value) };
  if (t === 'boolean') return { tag: 'bool', text: value ? 'true' : 'false' };
  if (t === 'object') {
    if ('x' in value && 'y' in value && 'z' in value) {
      return { tag: 'Vector3', text: `${value.x}, ${value.y}, ${value.z}` };
    }
    return { tag: 'string', text: JSON.stringify(value) };
  }
  return { tag: 'string', text: String(value) };
}

function buildItem(parent, item, counter) {
  const referent = `RBX${counter.count++}`;
  const el = parent.ele('Item').att('class', item.class || 'Model').att('referent', referent);

  if (item.properties && typeof item.properties === 'object') {
    const props = el.ele('Properties');
    for (const [k, v] of Object.entries(item.properties)) {
      const formatted = formatValue(v);
      if (!formatted) continue;
      props.ele(formatted.tag).att('name', k).txt(formatted.text);
    }
  }

  if (Array.isArray(item.children)) {
    for (const child of item.children) buildItem(el, child, counter);
  }

  return el;
}

function jsonToRBXM(root) {
  const doc = create({ version: '1.0', encoding: 'utf-8' }).ele('roblox').att('version', '4');
  const counter = { count: 0 };

  if (Array.isArray(root)) {
    for (const item of root) buildItem(doc, item, counter);
  } else {
    buildItem(doc, root, counter);
  }

  return doc.end({ prettyPrint: true });
}

module.exports = { jsonToRBXM };
