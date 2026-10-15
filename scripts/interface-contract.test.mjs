import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

test('every tab group owns a panel, including device selectors', () => {
  let groups = 0;
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'Tabs') {
      groups++;
      const panels = node.children.filter(child =>
        ts.isJsxElement(child) && child.openingElement.tagName.getText(tree) === 'TabsContent');
      if (node.openingElement.getText(tree).includes('host-tabs')) {
        assert.equal(panels.length, 1, 'device tabs need their own result panel');
        const value = node.openingElement.attributes.properties.find(p => p.name?.getText(tree) === 'value');
        const panelValue = panels[0].openingElement.attributes.properties.find(p => p.name?.getText(tree) === 'value');
        assert.equal(panelValue.initializer.getText(tree), value.initializer.getText(tree));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.equal(groups, 3);
});

test('public copy contains no em dashes', async () => {
  for (const file of ['app/page.tsx', 'README.md', 'AGENTS.md', 'docs/DESIGN.md']) {
    const text = await readFile(new URL('../' + file, import.meta.url), 'utf8');
    assert.equal(text.includes(String.fromCodePoint(0x2014)), false, file);
  }
});
