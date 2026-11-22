#!/usr/bin/env node
/** Validate repository content using local Draft 2020-12 JSON Schemas and cross-file checks. */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaRoot = path.join(repoRoot, 'schemas');
const contentDirArg = process.argv.indexOf('--content-dir');
if (contentDirArg !== -1 && !process.argv[contentDirArg + 1]) {
  console.error('Usage: node scripts/validate-content.mjs [--content-dir /path/to/content]');
  process.exit(2);
}
const contentRoot = contentDirArg === -1 ? path.join(repoRoot, 'data', 'content') : path.resolve(process.argv[contentDirArg + 1]);
const EDITIONS = new Set(['1e', '2e', '3e', '3.5e', '4e', '5e', '5.5e']);
const LINK_KINDS = new Set(['species','class','subclass','rule','spell','monster','location','external','background','feat','item','magic-item','condition','equipment','organization','npc']);
const SCHEMAS = [
  'common/content-block.schema.json', 'common/article-section.schema.json', 'common/source.schema.json',
  'species/index.schema.json', 'species/edition.schema.json',
  'faq/article.schema.json', 'faq/index.schema.json'
];
const licenseAttribution = {
  'srd-5.1': 'This work includes material taken from the System Reference Document 5.1 (“SRD 5.1”) by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.',
  'srd-5.2.1': 'This work includes material from the System Reference Document 5.2.1 (“SRD 5.2.1”) by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.'
};
const errors = [];
const warnings = [];
const display = file => path.relative(repoRoot, file).split(path.sep).join('/');
const error = (file, reason) => errors.push(`${display(file)}: ${reason}`);
const warn = (file, reason) => warnings.push(`${display(file)}: ${reason}`);

async function discover(directory) {
  const out = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, item.name);
    if (item.isDirectory()) out.push(...await discover(full));
    else if (item.isFile() && item.name.endsWith('.json')) out.push(full);
  }
  return out.sort();
}
function routeFor(file) {
  const r = path.relative(contentRoot, file).split(path.sep);
  if (r[0] !== 'species') return null; // Adding another type requires a schema route.
  if (r.length === 3 && r[2] === 'index.json') return 'species/index.schema.json';
  if (r.length === 4 && r[2] === 'editions' && r[3].endsWith('.json')) return 'species/edition.schema.json';
  if (r.length === 4 && r[2] === 'faq' && r[3].endsWith('.json')) return 'faq/index.schema.json';
  if (r.length === 5 && r[2] === 'faq' && EDITIONS.has(r[3]) && r[4].endsWith('.json')) return 'faq/article.schema.json';
  return null;
}
function unique(items, label, file) {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item)) error(file, `duplicate ${label}: ${item}`);
    seen.add(item);
  }
}
function strings(value, visit, pointer = '') {
  if (typeof value === 'string') visit(value, pointer || '/');
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, visit, `${pointer}/${i}`));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([k,v]) => strings(v,visit,`${pointer}/${k}`));
}
function validateInline(value, pointer, file, registered) {
  const pattern = /\[\[([^\]\r\n]*)\]\]/g;
  const validTarget = /^([a-z][a-z0-9-]*):([a-z0-9]+(?:-[a-z0-9]+)*)(?:@([1-5](?:\.5)?e))?$/;
  let found, remaining = value, targets = [];
  while ((found = pattern.exec(value)) !== null) {
    remaining = remaining.replace(found[0], '');
    const parts = found[1].split('|');
    if (parts.length > 2 || (parts.length === 2 && !parts[1].trim())) {
      error(file, `${pointer}: malformed inline label: ${found[0]}`); continue;
    }
    const target = parts[0], match = validTarget.exec(target);
    if (!match || !LINK_KINDS.has(match[1]) || (match[3] && !EDITIONS.has(match[3]))) {
      error(file, `${pointer}: malformed inline target: ${found[0]}`); continue;
    }
    targets.push(target);
  }
  if (remaining.includes('[[') || remaining.includes(']]')) error(file, `${pointer}: unbalanced inline reference brackets`);
  for (const target of targets) if (!registered.has(target)) warn(file, `${pointer}: valid link ${target} has no target in the assets JSON registry; resolve through the Wiki in a future integration`);
}
function checkSourceRefs(file, sourceIds, sourceMap, context) {
  unique(sourceIds || [], `${context} source ID`, file);
  for (const id of sourceIds || []) if (!sourceMap.has(id)) error(file, `${context}: unresolved source ID '${id}'`);
}
function checkMechanics(file, entry) {
  const { mechanics: m, article } = entry;
  const basic = article?.sections?.find(x => x.id === 'basic-traits');
  if (!basic) { warn(file, 'no basic-traits section for mechanical table consistency'); return; }
  const rowPairs = basic.blocks.filter(b=>b.type==='table').flatMap(b=>b.rows.filter(r=>r.length>=2));
  if (!rowPairs.length) { warn(file, 'no basic-traits table for consistency checks'); return; }
  const rows = new Map(rowPairs.map(r => [r[0].toLowerCase().trim(), r.slice(1).join(' ').toLowerCase()]));
  const get = expression => [...rows.entries()].find(([k]) => expression.test(k))?.[1];
  const size = get(/^size$/), speed = get(/^(walking )?speed$/), abilities = get(/^ability( scores?| score improvements?)$/);
  if (size) {
    const values = m.size.category === 'choice' ? m.size.options : [m.size.category];
    for (const value of values || []) if (!size.includes(value.toLowerCase())) error(file, `basic-traits Size table contradicts mechanics.size (${value})`);
  }
  if (speed && !new RegExp(`\\b${m.speed.walking.value}\\s*(?:feet|ft)\\b`).test(speed)) error(file, `basic-traits Speed table contradicts mechanics.speed (${m.speed.walking.value} feet)`);
  const creatureType = get(/^creature type$/);
  if (creatureType && !creatureType.includes(m.creatureType.toLowerCase())) error(file, 'basic-traits creature type contradicts mechanics.creatureType');
  if (abilities && m.abilityScoreIncrease?.type === 'fixed-all-six' && (!abilities.includes('+1') || !abilities.includes('strength') || !abilities.includes('charisma'))) error(file,'basic-traits ability-score row contradicts the fixed six increases');
  if (abilities && m.abilityScoreIncrease?.grantedBySpecies === false && !/background|no species|none/.test(abilities)) error(file,'basic-traits ability-score row implies a species ability increase');
  const languages = get(/^languages?$/);
  if (languages && m.languages?.automatic?.includes('Common') && !languages.includes('common')) error(file,'basic-traits language row omits Common');
  if (languages && m.languages?.source === 'character-creation' && !/character.creation|character creation/.test(languages)) error(file,'basic-traits languages must identify character creation as the source');
  const resourceful = m.traits?.find(t=>t.name==='Resourceful');
  if (resourceful) {
    const row = get(/^resourceful$/);
    if (row && (!/long rest/.test(row)||!/heroic inspiration/.test(row))) error(file,'basic-traits Resourceful row contradicts structured trait');
    if (resourceful.trigger?.event !== 'finish-long-rest' || resourceful.resourceRules?.maxHeld !== 1) error(file,'Resourceful must grant Heroic Inspiration after finishing a Long Rest, with cap one');
  }
  if (m.traits?.some(t=>t.name==='Skillful')) {
    const row=get(/^skillful$/); if (row && !/skill/.test(row)) error(file,'Skillful table contradicts trait');
  }
  if (m.traits?.some(t=>t.name==='Versatile')) {
    const row=get(/^versatile$/); if (row && !/origin feat/.test(row)) error(file,'Versatile table contradicts feat trait');
  }
}

async function main() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const schemaIds = new Map();
  for (const rel of SCHEMAS) {
    const schema = JSON.parse(await readFile(path.join(schemaRoot, rel), 'utf8'));
    ajv.addSchema(schema);
    schemaIds.set(rel, schema.$id);
  }
  const files = await discover(contentRoot);
  if (!files.length) error(contentRoot, 'No content JSON files found');
  const entries = new Map();
  const ids = new Map();
  const registered = new Set();
  for (const file of files) {
    let document;
    try { document = JSON.parse(await readFile(file, 'utf8')); }
    catch (cause) { error(file, `invalid JSON: ${cause.message}`); continue; }
    const route = routeFor(file);
    if (!route) { error(file, 'No schema registered for this content path/type (fail closed; add a schema route)'); continue; }
    const valid = ajv.validate(schemaIds.get(route), document);
    if (!valid) for (const issue of ajv.errors || []) error(file, `schema ${issue.instancePath || '/'} ${issue.message}`);
    entries.set(path.resolve(file), { file, document, route });
    if (typeof document.id === 'string') {
      if (ids.has(document.id)) error(file, `duplicate document ID '${document.id}' (also ${display(ids.get(document.id))})`);
      ids.set(document.id, file);
      registered.add(document.id);
    }
    if (route==='species/index.schema.json' && typeof document.slug==='string') registered.add(`species:${document.slug}`);
  }
  const articleByFile = new Set();
  for (const {file, document: doc, route} of entries.values()) {
    const rel=path.relative(contentRoot,file).split(path.sep);
    const species = rel[1];
    if (rel[0]==='species') {
      if (route==='species/index.schema.json') {
        if (doc.id!==`species:${species}` || doc.slug!==species) error(file, 'Species ID/slug must match directory name');
        if (!doc.editions?.includes(doc.defaultEdition)) error(file, 'defaultEdition missing from editions list');
        unique(doc.editions||[],'edition',file);
        for(const edition of doc.editions||[]) {
          const target=path.join(contentRoot,'species',species,'editions',`${edition}.json`);
          if (!entries.has(target)) error(file, `Edition ${edition} is listed but ${display(target)} does not exist`);
        }
      }
      if (route==='species/edition.schema.json') {
        const edition=rel[3].replace(/\.json$/,'');
        if (!EDITIONS.has(edition)||doc.edition!==edition||doc.id!==`species:${species}@${edition}`||doc.contentId!==`species:${species}`) error(file, 'Edition ID/contentId/filename mismatch');
        const sourceMap=new Map((doc.sources||[]).map(s=>[s.id,s]));
        unique((doc.sources||[]).map(s=>s.id),'source ID',file);
        for(const source of doc.sources||[]) {
          if(source.license?.id==='CC-BY-4.0' && !source.attribution) error(file, `Missing CC attribution for ${source.id}`);
          if(licenseAttribution[source.id] && source.attribution!==licenseAttribution[source.id]) error(file, `SRD legal attribution does not match official statement for ${source.id}`);
          if(source.id==='srd-5.1' && source.url!=='https://media.wizards.com/2023/downloads/dnd/SRD_CC_v5.1.pdf') error(file,'SRD 5.1 source URL must point to official PDF');
        }
        unique((doc.mechanics?.traits||[]).map(t=>t.id),'trait ID',file);
        for (const trait of doc.mechanics?.traits||[]) checkSourceRefs(file,trait.sourceIds,sourceMap,`trait ${trait.id}`);
        checkSourceRefs(file,doc.mechanics?.sourceIds,sourceMap,'mechanics');
        for (const variant of doc.optionalVariants||[]) checkSourceRefs(file,variant.sourceIds,sourceMap,`variant ${variant.id}`);
        for(const section of doc.article?.sections||[]) unique(section.blocks.map((b,i)=>b.id).filter(Boolean),'block ID',file);
        unique((doc.article?.sections||[]).map(s=>s.id),'article section ID',file);
        checkMechanics(file,doc);
      }
      if(route==='faq/article.schema.json') {
        const edition=rel[3],slug=rel[4].replace(/\.json$/,'');
        if(!EDITIONS.has(edition)||doc.edition!==edition||doc.slug!==slug||doc.contentId!==`species:${species}`) error(file,'FAQ edition/slug/contentId mismatch');
        unique((doc.sections||[]).map(s=>s.id),'FAQ section ID',file);
        const editionEntry=entries.get(path.join(contentRoot,'species',species,'editions',`${edition}.json`));
        if(editionEntry)checkSourceRefs(file,doc.sourceIds,new Map((editionEntry.document.sources||[]).map(s=>[s.id,s])),'FAQ');
        else error(file,`No edition source registry for FAQ (${edition})`);
      }
      if(route==='faq/index.schema.json') {
        const edition=rel[3].replace(/\.json$/,'');
        if(!EDITIONS.has(edition)||doc.edition!==edition||doc.id!==`species:${species}@${edition}:faq`||doc.contentId!==`species:${species}`) error(file,'FAQ index edition/contentId mismatch');
        unique((doc.items||[]).map(x=>x.id),'FAQ index ID',file);
        unique((doc.items||[]).map(x=>x.file),'FAQ index file',file);
        for(const item of doc.items||[]) {
          const full=path.resolve(path.dirname(file),item.file);
          if(!full.startsWith(path.resolve(contentRoot)+path.sep)) {error(file,`FAQ reference escapes content directory: ${item.file}`);continue;}
          const target=entries.get(full);
          if (!target) {error(file,`FAQ file not found: ${item.file}`);continue;}
          if(target.route!=='faq/article.schema.json'||target.document.id!==item.id||target.document.edition!==doc.edition||target.document.contentId!==doc.contentId) error(file,`FAQ index metadata mismatch: ${item.file}`);
          articleByFile.add(full);
        }
      }
    }
    strings(doc,(value,pointer)=>validateInline(value,pointer,file,registered));
  }
  for(const {file,route} of entries.values()) if(route==='faq/article.schema.json'&&!articleByFile.has(file)) error(file,'FAQ article not referenced by its edition FAQ index');
  for(const entry of warnings)console.warn(`WARN ${entry}`);
  for(const entry of errors)console.error(`ERROR ${entry}`);
  console.log(`Content validation: ${files.length} JSON files, ${errors.length} error(s), ${warnings.length} unresolved-link warning(s).`);
  if(errors.length)process.exitCode=1;
}
main().catch(e=>{console.error(`Validation failed: ${e.stack||e.message}`);process.exitCode=1;});
