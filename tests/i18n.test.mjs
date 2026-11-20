import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const messages = JSON.parse(fs.readFileSync('src/renderer/src/locales/messages.json','utf8'));
const placeholders = text => [...text.matchAll(/\{\d+\}/g)].map(match=>match[0]).sort();
for(const [key, translations] of Object.entries(messages)) {
  assert.equal(translations.length,3,key);
  for(const text of translations) {
    assert.ok(text.trim(),key);
    assert.deepEqual(placeholders(text),placeholders(key),key);
  }
}
for(const name of ['App','CaptionEditor','ImageGenerator','PlatformSettings','PublishHistory','RunLogs','LanguageSelect']) {
  const source=fs.readFileSync(`src/renderer/src/${name}.tsx`,'utf8');
  const ast=ts.createSourceFile(name,source,99,true,ts.ScriptKind.TSX);
  function visit(node) {
    if(ts.isCallExpression(node)&&node.expression.getText(ast)==='t'&&ts.isStringLiteral(node.arguments[0])) assert.ok(messages[node.arguments[0].text],`Missing translation: ${node.arguments[0].text}`);
    ts.forEachChild(node,visit);
  }
  visit(ast);
}
const storage=new Map();
const sandbox={exports:{},document:{documentElement:{}},localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},require:name=>name==='react'?{useSyncExternalStore:(_subscribe,getSnapshot)=>getSnapshot()}:messages};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/renderer/src/i18n.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,sandbox);
const {t,setLanguage}=sandbox.exports;
for(const [language,index] of [['en',0],['ja',1],['ko',2]]) {
  setLanguage(language);
  assert.equal(t('素材库'),messages['素材库'][index]);
  assert.equal(t('已创建 {0} 条发布草稿。',[7]),messages['已创建 {0} 条发布草稿。'][index].replace('{0}','7'));
  assert.equal(t('unknown'),'unknown');
  assert.equal(t('{0}', ['$& {1}']),'$& {1}');
}
setLanguage('zh-CN');assert.equal(t('素材库'),'素材库');
setLanguage('invalid');assert.equal(sandbox.document.documentElement.lang,'zh-CN');
console.log('PASS: complete message coverage, placeholder parity, interpolation, fallback, and language validation');
