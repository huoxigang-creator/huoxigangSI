import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {basename, join} from 'node:path';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function parse(path) {return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);}
function visit(node, callback) {callback(node); ts.forEachChild(node, child => visit(child, callback));}
function tag(node) {return ts.isJsxElement(node) ? node.openingElement.tagName.getText() : ts.isJsxSelfClosingElement(node) ? node.tagName.getText() : '';}
function props(node) {return (ts.isJsxElement(node) ? node.openingElement.attributes : node.attributes).properties.filter(ts.isJsxAttribute);}
function hasProp(node, name) {return props(node).some(attribute => attribute.name.getText() === name);}
// 打印容器（如草稿打印稿 qwDraftPrint）里的表格是纸质输出，不是可排序业务列表。
function isPrintContainer(node) {return (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) && props(node).some(attribute => attribute.name.getText() === 'className' && String(attribute.initializer?.getText?.() ?? '').includes('qwDraftPrint'));}
function sourceFiles(directory) {return readdirSync(directory, {withFileTypes:true}).flatMap(entry => entry.isDirectory() ? sourceFiles(join(directory, entry.name)) : entry.name.endsWith('.tsx') ? [join(directory, entry.name)] : []);}

test('business table views all use the shared row and column controls with a stable namespace', () => {
  const violations = [];
  for (const path of sourceFiles('app')) {
    // Print output and temporary import/profit previews are not persisted business lists.
    if (['managed-table.tsx','customer-quote-print.tsx','hardware-import.tsx','document-import.tsx','quote-profit.tsx','shared-quote.tsx'].includes(basename(path))) continue;
    visit(parse(path), node => {
      if (tag(node) === 'table') {
        // Form rows, customer read-only statements and print containers are not sortable business lists.
        let ancestor=node.parent;
        while(ancestor&&tag(ancestor)!=='fieldset'&&tag(ancestor)!=='form'&&!isPrintContainer(ancestor))ancestor=ancestor.parent;
        if(!ancestor)violations.push(`${path}: plain table bypasses shared controls`);
      }
      if (tag(node) === 'ManagedTable' && !hasProp(node, 'tableKey')) violations.push(`${path}: shared table has no preference namespace`);
    });
  }
  assert.deepEqual(violations, []);
});

test('existing project, cash, material, purchase, file and trash views preserve stable selectable row identities', () => {
  const expected = {'manager-lists.tsx':2, 'configuration.tsx':1, 'purchase-orders.tsx':3, 'project-files.tsx':1, 'trash.tsx':1};
  for (const [file, count] of Object.entries(expected)) {
    let tables = 0, bodyRows = 0;
    const violations = [];
    visit(parse('app/' + file), node => {
      if (tag(node) === 'ManagedTable') {tables++; assert.ok(hasProp(node, 'disabled'), `${file} locks table preferences during a pending action`);}
      if (tag(node) !== 'tr') return;
      let parent = node.parent;
      while (parent && !['tbody','thead','tfoot'].includes(tag(parent))) parent = parent.parent;
      if (tag(parent) !== 'tbody') return;
      bodyRows++;
      if (!hasProp(node, 'key') || !hasProp(node, 'data-row-id')) violations.push(`${file}: body row has no stable key and row ID`);
    });
    assert.equal(tables, count, file);
    assert.ok(bodyRows > 0, file);
    assert.deepEqual(violations, []);
  }
});

test('purchase draft movements change saved item order while retaining the exact values and refusing stale IDs', () => {
  const file = parse('app/purchase-orders.tsx');
  let declaration;
  visit(file, node => {if (ts.isFunctionDeclaration(node) && node.name?.text === 'reorderItems') declaration = node;});
  assert.ok(declaration);
  const code = ts.transpileModule(declaration.getText(file), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const first = {rowId:'row-a', name:'匿名材料甲', quantity:'2', price:'9.39', code:'A', unit:'张'};
  const second = {rowId:'row-b', name:'匿名材料乙', quantity:'3', price:'6.20', code:'B', unit:'米'};
  let current = {order:null,createId:'offline-new',draft:{number:'offline',items:[first,second],note:'保留'}};
  const context = {busy:false,docImportBusy:false,get editorDisabled(){return this.busy||this.docImportBusy;}, setEditor:update => {current = update(current);}};
  const reorder = runInNewContext(code + '\nreorderItems;', context);
  reorder(['row-b','row-a']);
  assert.equal(current.draft.items[0], second);
  assert.equal(current.draft.items[1], first);
  assert.equal(current.draft.number, 'offline');
  assert.equal(current.draft.note, '保留');
  assert.equal(current.createId, 'offline-new');
  const reordered = current;
  for (const ids of [['row-a'], ['row-a','row-a'], ['row-a','unknown']]) {reorder(ids); assert.equal(current, reordered);}
  context.busy = true; reorder(['row-a','row-b']); assert.equal(current, reordered);
  context.busy = false;context.docImportBusy = true;reorder(['row-a','row-b']);assert.equal(current,reordered);
  const managedEditor = [];
  visit(file, node => {if (tag(node) === 'ManagedTable' && props(node).some(attribute => attribute.name.getText() === 'tableKey' && attribute.initializer?.getText().includes('"purchase/editor/"'))) managedEditor.push(node);});
  assert.equal(managedEditor.length, 1);
  assert.ok(hasProp(managedEditor[0], 'onRowsReorder'), 'a displayed draft move is connected to the data saved by the existing form');
});

test('filtered project, transaction and material views pass the full source order before preferences exist', () => {
  let listTables = 0, materialTables = 0;
  visit(parse('app/manager-lists.tsx'), node => {
    if (tag(node) !== 'ManagedTable') return;
    listTables++; assert.ok(hasProp(node, 'allRowOrder'), 'project/cash tables receive hidden row identities');
  });
  visit(parse('app/configuration.tsx'), node => {
    if (tag(node) !== 'ManagedTable') return;
    materialTables++; assert.ok(hasProp(node, 'allRowOrder'), 'material table receives the unfiltered catalog order');
    const fullOrder = props(node).find(attribute => attribute.name.getText() === 'allRowOrder').initializer.getText();
    assert.match(fullOrder, /catalog\?\.materials\.map/, 'materials use the full catalog, rather than the search results');
  });
  assert.equal(listTables, 2); assert.equal(materialTables, 1);
  visit(parse('app/manager.tsx'), node => {
    if (['ProjectList', 'TransactionList'].includes(tag(node))) assert.ok(hasProp(node, 'allRowOrder'), 'list callers pass the unfiltered source order');
  });
});

test('first move while already filtered retains hidden row slots, persists full IDs, and locks while busy', async () => {
  const file = parse('app/managed-table.tsx'); let declaration;
  visit(file, node => {if (ts.isFunctionDeclaration(node) && node.name?.text === 'applyOrder') declaration = node;});
  assert.ok(declaration);
  const moduleCode = ts.transpileModule(readFileSync('lib/table-preferences.ts', 'utf8'), {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  const {orderedRows, mergeVisibleOrder} = await import('data:text/javascript;base64,' + Buffer.from(moduleCode).toString('base64'));
  const code = ts.transpileModule(declaration.getText(file), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const full = ['row-a', 'hidden-one', 'row-b', 'hidden-two', 'row-c'], visible = ['row-a', 'row-b', 'row-c'];
  let saved, changes = [];
  const context = {disabled:false, resize:{current:null}, columnDrag:{current:null}, allRowOrder:full, allIDs:visible, preferences:{hidden:['备注'],order:[]}, orderedRows, mergeVisibleOrder, update:value => {saved = value;}, onRowsReorder:ids => changes.push(ids)};
  const apply = runInNewContext(code + '\napplyOrder;', context);
  apply(['row-c', 'row-a', 'row-b']);
  assert.deepEqual(Array.from(saved.order), ['row-c', 'hidden-one', 'row-a', 'hidden-two', 'row-b']);
  assert.deepEqual(saved.hidden, ['备注']); assert.deepEqual(changes, [['row-c', 'row-a', 'row-b']]);
  assert.deepEqual(full, ['row-a', 'hidden-one', 'row-b', 'hidden-two', 'row-c']); assert.deepEqual(visible, ['row-a', 'row-b', 'row-c']);
  const previous = saved; context.disabled = true; apply(['row-a', 'row-b', 'row-c']);
  assert.equal(saved, previous); assert.equal(changes.length, 1);
});

test('filtered movement preserves prior hidden slots and appends new visible IDs missing from source order', async () => {
  const file = parse('app/managed-table.tsx'); let declaration;
  visit(file, node => {if (ts.isFunctionDeclaration(node) && node.name?.text === 'applyOrder') declaration = node;});
  const moduleCode = ts.transpileModule(readFileSync('lib/table-preferences.ts', 'utf8'), {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  const {orderedRows, mergeVisibleOrder} = await import('data:text/javascript;base64,' + Buffer.from(moduleCode).toString('base64'));
  const code = ts.transpileModule(declaration.getText(file), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  let saved;
  const context = {disabled:false, resize:{current:null}, columnDrag:{current:null}, allRowOrder:['row-a','hidden','row-b'], allIDs:['row-a','row-b','new-row'], preferences:{hidden:[],order:['hidden','row-b','row-a']}, orderedRows, mergeVisibleOrder, update:value => {saved = value;}, onRowsReorder:undefined};
  runInNewContext(code + '\napplyOrder;', context)(['row-a','new-row','row-b']);
  assert.deepEqual(Array.from(saved.order), ['hidden','row-a','new-row','row-b']);
});
