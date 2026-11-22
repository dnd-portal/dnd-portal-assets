#!/usr/bin/env node
/** Regression tests; mutations occur only in a disposable temporary copy. */
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sample = path.join(root, 'data', 'content');
const tmp = await mkdtemp(path.join(tmpdir(), 'dnd-portal-validate-'));
const work = path.join(tmp, 'content');
const runner = path.join(root, 'scripts', 'validate-content.mjs');
function run() { return spawnSync(process.execPath, [runner, '--content-dir', work], {encoding:'utf8'}); }
function expect(condition, message, result) {
  if (!condition) throw Error(`${message}\n${result?.stdout ?? ''}\n${result?.stderr ?? ''}`);
}
try {
  await cp(sample, work, {recursive:true});
  let result = run();
  expect(result.status===0, 'Valid content must pass', result);
  const faq = path.join(work, 'species', 'human', 'faq', '5e.json');
  const pristineFaq = await readFile(faq, 'utf8');
  const brokenReference = JSON.parse(pristineFaq);
  brokenReference.items[0].file = './5e/missing-article.json';
  await writeFile(faq, JSON.stringify(brokenReference,null,2));
  result = run();
  expect(result.status!==0 && /FAQ file not found/.test(result.stderr), 'Missing FAQ target must fail', result);
  await writeFile(faq, pristineFaq);

  const indexFile = path.join(work, 'species', 'human', 'index.json');
  const pristineIndex = await readFile(indexFile,'utf8');
  const brokenEdition = JSON.parse(pristineIndex);
  brokenEdition.defaultEdition = '4e';
  await writeFile(indexFile, JSON.stringify(brokenEdition,null,2));
  result=run();
  expect(result.status!==0 && /defaultEdition/.test(result.stderr), 'Invalid default edition must fail', result);
  await writeFile(indexFile, pristineIndex);

  await writeFile(faq, '{ broken json');
  result=run();
  expect(result.status!==0 && /invalid JSON/.test(result.stderr), 'Broken JSON syntax must fail', result);
  await writeFile(faq, pristineFaq);

  result=run();
  expect(result.status===0,'Restored clean content must pass', result);
  console.log('PASS: clean dataset, missing FAQ, invalid default edition, malformed JSON, restored dataset');
} finally {
  await rm(tmp,{recursive:true,force:true});
}
