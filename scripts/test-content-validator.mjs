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

  // Child-option regression tests run against an isolated copy, never the repository.
  const childBase = path.join(work, 'species', 'elf', 'options', 'high-elf');
  const childIndex = path.join(childBase, 'index.json');
  const childEdition = path.join(childBase, 'editions', '5e.json');
  const childFaqIndex = path.join(childBase, 'faq', '5e.json');
  const childFaqArticle = path.join(childBase, 'faq', '5e', 'what-is-a-high-elf.json');
  const elfEdition = path.join(work, 'species', 'elf', 'editions', '5e.json');
  async function negative(file, change, expression, label) {
    const pristine = await readFile(file, 'utf8');
    try {
      const document = JSON.parse(pristine);
      change(document);
      await writeFile(file, JSON.stringify(document, null, 2));
      const result = run();
      expect(result.status !== 0 && expression.test(result.stderr), label, result);
    } finally {
      await writeFile(file, pristine);
    }
  }
  await negative(childIndex, d => { d.parentId = 'species:missing-parent'; }, /parentId|parent reference/i, 'Broken child parent ID must fail');
  await negative(childEdition, d => { d.parentEdition = '5.5e'; }, /parentEdition|inheritance|edition mismatch/i, 'Wrong child parent edition must fail');
  await negative(childFaqIndex, d => { d.items[0].id = 'wrong-faq-id'; }, /child FAQ index metadata mismatch/i, 'Child FAQ ID mismatch must fail');
  await negative(childFaqIndex, d => { d.items[0].file = './5e/missing-child-faq.json'; }, /FAQ file not found/i, 'Missing child FAQ file must fail');
  await negative(childIndex, d => { d.editions.push('5.5e'); }, /child edition 5\.5e.*does not exist/i, 'Unimplemented child edition advertised as available must fail');
  await negative(elfEdition, d => {
    const option = d.mechanics.subraceSelection.options.find(x => x.key === 'high-elf');
    option.status = 'pending-child-content';
    delete option.contentId;
    d.mechanics.subraceSelection.availability = 'pending-child-content';
  }, /not registered as implemented|present but parent marks it pending/i, 'Missing parent registration must fail');
  await negative(childEdition, d => { d.mechanics.additions.size = { category: 'Medium' }; }, /inherited mechanic 'size'/i, 'Copied inherited mechanics must fail');
  await negative(childFaqArticle, d => { d.introduction += ' [[species-option:high-elf@2014|High Elf]]'; }, /malformed inline target/i, 'Malformed child inline reference must fail');
  result=run();
  expect(result.status===0,'Restored clean content must pass', result);
  console.log('PASS: clean dataset, original negative tests, broken child parent, wrong edition, missing/mismatched child FAQs, missing registration, inherited mechanics duplication, malformed inline link, restored dataset');
} finally {
  await rm(tmp,{recursive:true,force:true});
}
