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
const LINK_KINDS = new Set(['species','species-option','class','subclass','rule','spell','monster','location','external','background','feat','item','magic-item','condition','equipment','organization','npc']);
const SCHEMAS = [
  'common/content-block.schema.json', 'common/article-section.schema.json', 'common/source.schema.json',
  'species/index.schema.json', 'species/edition.schema.json',
  'faq/article.schema.json', 'faq/index.schema.json',
  'species/options/index.schema.json', 'species/options/edition.schema.json',
  'species/options/faq-article.schema.json', 'species/options/faq-index.schema.json'
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
  if (r[0] !== 'species') return null;
  // Nested species options inherit the parent species, but own mechanics and FAQs.
  if (r[2] === 'options') {
    if (r.length === 5 && r[4] === 'index.json') return 'species/options/index.schema.json';
    if (r.length === 6 && r[4] === 'editions' && r[5].endsWith('.json')) return 'species/options/edition.schema.json';
    if (r.length === 6 && r[4] === 'faq' && r[5].endsWith('.json')) return 'species/options/faq-index.schema.json';
    if (r.length === 7 && r[4] === 'faq' && EDITIONS.has(r[5]) && r[6].endsWith('.json')) return 'species/options/faq-article.schema.json';
    return null;
  }
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

/** Reusable child-option checks shared by subraces, lineages, and later species options. */
function checkParentOptionRegistration(file, doc, entries, species) {
  const edition = doc.edition;
  for (const [field, kind] of [['subraceSelection', 'subrace'], ['lineageSelection', 'lineage']]) {
    const selection = doc.mechanics?.[field];
    if (!selection?.options) continue;
    unique(selection.options.map(o => o.key), `${field} option key`, file);
    const implemented = selection.options.filter(o => o.status === 'child-content-available');
    const expected = implemented.length ? 'child-content-available' : 'pending-child-content';
    if (selection.availability !== expected) error(file, `${field}.availability must be ${expected} given the registered children`);
    for (const option of selection.options) {
      if (option.status === 'child-content-available') {
        const childId = `species-option:${option.key}`;
        if (option.contentId !== childId) error(file, `${field}: implemented child ${option.key} needs contentId '${childId}'`);
        const childFile = path.join(contentRoot, 'species', species, 'options', option.key, 'editions', `${edition}.json`);
        const child = entries.get(childFile);
        if (!child || child.route !== 'species/options/edition.schema.json' || child.document.id !== `${childId}@${edition}` || child.document.kind !== kind) {
          error(file, `${field}: implemented child ${option.key} has no matching ${edition} ${kind} edition document`);
        }
      } else if (option.status === 'pending-child-content') {
        const childFile = path.join(contentRoot, 'species', species, 'options', option.key, 'editions', `${edition}.json`);
        if (entries.has(childFile)) error(file, `${field}: child ${option.key} is present but parent marks it pending`);
        if (option.contentId) error(file, `${field}: pending child ${option.key} must not advertise a published contentId`);
      } else {
        error(file, `${field}: unsupported child status ${option.status}`);
      }
    }
  }
}

function checkOptionMechanics(file, doc, parent) {
  const mechanics = doc.mechanics ?? {};
  const additions = mechanics.additions ?? {};
  const parentMechanics = parent?.mechanics ?? {};
  const overrides = mechanics.overrides ?? [];
  unique(overrides.map(o => o.field), 'child override field', file);
  const overridden = new Set(overrides.map(o => o.field));
  for (const key of Object.keys(additions)) {
    if (key === 'traits') continue;
    if (Object.prototype.hasOwnProperty.call(parentMechanics, key)) {
      if (key === 'abilityScoreIncrease' || key === 'languages') {
        if (JSON.stringify(additions[key]) === JSON.stringify(parentMechanics[key])) error(file, `duplicated inherited mechanic '${key}'`);
      } else if (!overridden.has(key) && ![...overridden].some(f => f.startsWith(`${key}.`))) {
        error(file, `inherited mechanic '${key}' must be represented as an explicit override, not copied into additions`);
      }
    }
  }
  const parentTraits = new Set((parentMechanics.traits ?? []).map(t => t.id));
  unique((additions.traits ?? []).map(t => t.id), 'child trait ID', file);
  for (const trait of additions.traits ?? []) if (parentTraits.has(trait.id)) error(file, `duplicate inherited trait ID '${trait.id}'`);
  for (const item of overrides) {
    if (!item.field || !(item.field.split('.')[0] in parentMechanics)) error(file, `override '${item.field}' does not target an inherited parent mechanic`);
  }
  const rows = (doc.article?.sections ?? []).find(s => s.id === 'basic-traits')?.blocks.filter(b => b.type === 'table').flatMap(t => t.rows) ?? [];
  const value = key => rows.find(r => r[0]?.toLowerCase() === key.toLowerCase())?.slice(1).join(' ').toLowerCase() ?? '';
  for (const [ability, amount] of Object.entries(additions.abilityScoreIncrease?.abilities ?? {})) {
    if (!rows.some(r => r.join(' ').toLowerCase().includes(ability.toLowerCase()) && r.join(' ').includes(`+${amount}`))) {
      error(file, `basic-traits table omits child ability increase ${ability} +${amount}`);
    }
  }
  for (const weapon of additions.weaponProficiencies?.weapons ?? []) {
    if (!rows.some(r => r.join(' ').toLowerCase().includes(weapon.toLowerCase()))) error(file, `basic-traits table omits child weapon proficiency '${weapon}'`);
  }
  if (additions.cantrip?.spellList && !value('Cantrip').includes(additions.cantrip.spellList.toLowerCase())) error(file, 'basic-traits Cantrip table does not match chosen spell list');
  if (additions.cantrip?.spellcastingAbility && !value('Cantrip').includes(additions.cantrip.spellcastingAbility.toLowerCase())) error(file, 'basic-traits Cantrip table does not match spellcasting ability');
  if (additions.languages?.additional?.count && !value('Extra Language')) error(file, 'basic-traits table omits additional language');
}

function checkSpeciesOption(file, doc, route, rel, entries, articleByFile) {
  const species = rel[1], option = rel[3], optionId = `species-option:${option}`;
  const indexPath = path.join(contentRoot, 'species', species, 'options', option, 'index.json');
  const parentIndex = entries.get(path.join(contentRoot, 'species', species, 'index.json'));
  if (!parentIndex || parentIndex.route !== 'species/index.schema.json') error(file, `parent reference missing: species:${species}`);
  const parentId = `species:${species}`;
  if (doc.parentId && doc.parentId !== parentId) error(file, `parentId must reference ${parentId}`);
  if (route === 'species/options/index.schema.json') {
    if (doc.id !== optionId || doc.type !== 'species-option' || doc.slug !== option || doc.parentId !== parentId) error(file, 'child index ID/type/slug/parentId mismatch');
    if (!doc.editions?.includes(doc.defaultEdition)) error(file, 'child defaultEdition missing from editions list');
    unique(doc.editions ?? [], 'child edition', file);
    for (const edition of doc.editions ?? []) {
      if (!parentIndex?.document.editions?.includes(edition)) error(file, `parent does not support child edition ${edition}`);
      if (!entries.has(path.join(contentRoot, 'species', species, 'options', option, 'editions', `${edition}.json`))) error(file, `child edition ${edition} is listed but its edition JSON does not exist`);
    }
  }
  if (route === 'species/options/edition.schema.json') {
    const edition = rel[5].replace(/\.json$/, '');
    const index = entries.get(indexPath);
    if (!index || index.route !== 'species/options/index.schema.json') error(file, `child index missing: ${display(indexPath)}`);
    if (!index?.document.editions?.includes(edition)) error(file, `child edition ${edition} is not listed in child index`);
    if (doc.edition !== edition || doc.parentEdition !== edition || doc.contentId !== optionId || doc.id !== `${optionId}@${edition}` || doc.parentId !== parentId) error(file, 'child edition ID/contentId/parentEdition/filename mismatch');
    const parent = entries.get(path.join(contentRoot, 'species', species, 'editions', `${edition}.json`));
    if (!parent || parent.route !== 'species/edition.schema.json' || !parentIndex?.document.editions?.includes(edition)) error(file, `parent edition ${edition} does not exist or is incompatible`);
    if (doc.inheritsFrom?.contentId !== parentId || doc.inheritsFrom?.edition !== edition || doc.inheritsFrom?.editionId !== `${parentId}@${edition}` || doc.inheritsFrom?.mergeStrategy !== 'parent-plus-additions') error(file, 'child inheritance parent reference or edition mismatch');
    const selection = parent?.document.mechanics?.[doc.kind === 'subrace' ? 'subraceSelection' : doc.kind === 'lineage' ? 'lineageSelection' : '__otherSelection'];
    if (!selection) error(file, `parent edition does not declare compatible child kind '${doc.kind}'`);
    const listing = selection?.options?.find(item => item.key === option);
    if (!listing || listing.status !== 'child-content-available' || listing.contentId !== optionId) error(file, `child ${optionId}@${edition} is not registered as implemented by its parent`);
    const sources = new Map((doc.sources ?? []).map(s => [s.id, s]));
    unique((doc.sources ?? []).map(s => s.id), 'child source ID', file);
    for (const source of doc.sources ?? []) {
      if (source.license?.id === 'CC-BY-4.0' && !source.attribution) error(file, `Missing CC attribution for ${source.id}`);
      if (licenseAttribution[source.id] && source.attribution !== licenseAttribution[source.id]) error(file, `SRD legal attribution does not match official statement for ${source.id}`);
      if (source.id === 'srd-5.1' && source.url !== 'https://media.wizards.com/2023/downloads/dnd/SRD_CC_v5.1.pdf') error(file, 'SRD 5.1 source URL must point to official PDF');
    }
    checkSourceRefs(file, doc.mechanics?.sourceIds, sources, 'child mechanics');
    for (const trait of doc.mechanics?.additions?.traits ?? []) checkSourceRefs(file, trait.sourceIds, sources, `child trait ${trait.id}`);
    for (const over of doc.mechanics?.overrides ?? []) checkSourceRefs(file, over.sourceIds, sources, `child override ${over.field}`);
    unique((doc.article?.sections ?? []).map(s => s.id), 'child article section ID', file);
    if (parent) checkOptionMechanics(file, doc, parent.document);
  }
  if (route === 'species/options/faq-article.schema.json') {
    const edition = rel[5], slug = rel[6].replace(/\.json$/, '');
    if (!EDITIONS.has(edition) || doc.edition !== edition || doc.slug !== slug || doc.contentId !== optionId) error(file, 'child FAQ edition/slug/contentId mismatch');
    unique((doc.sections ?? []).map(s => s.id), 'child FAQ section ID', file);
    if ((doc.sections ?? []).length < 6) error(file, 'child FAQ must contain at least six substantive sections');
    const editionEntry = entries.get(path.join(contentRoot, 'species', species, 'options', option, 'editions', `${edition}.json`));
    if (!editionEntry) error(file, `child FAQ edition ${edition} has no source registry`);
    else checkSourceRefs(file, doc.sourceIds, new Map((editionEntry.document.sources ?? []).map(s => [s.id, s])), 'child FAQ');
  }
  if (route === 'species/options/faq-index.schema.json') {
    const edition = rel[5].replace(/\.json$/, '');
    if (!EDITIONS.has(edition) || doc.edition !== edition || doc.id !== `${optionId}@${edition}:faq` || doc.contentId !== optionId) error(file, 'child FAQ index ID/edition/contentId mismatch');
    if (!entries.has(path.join(contentRoot, 'species', species, 'options', option, 'editions', `${edition}.json`))) error(file, `child FAQ index edition ${edition} does not exist`);
    unique((doc.items ?? []).map(x => x.id), 'child FAQ index ID', file);
    unique((doc.items ?? []).map(x => x.file), 'child FAQ index file', file);
    for (const item of doc.items ?? []) {
      const full = path.resolve(path.dirname(file), item.file);
      const expectedDir = path.resolve(path.dirname(file), edition);
      if (!full.startsWith(expectedDir + path.sep)) { error(file, `child FAQ reference must be inside the matching edition directory: ${item.file}`); continue; }
      const target = entries.get(full);
      if (!target) { error(file, `FAQ file not found: ${item.file}`); continue; }
      if (target.route !== 'species/options/faq-article.schema.json' || target.document.id !== item.id || target.document.edition !== edition || target.document.contentId !== optionId || target.document.slug !== path.basename(full, '.json')) error(file, `child FAQ index metadata mismatch: ${item.file}`);
      articleByFile.add(full);
    }
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
    if (route.startsWith('species/options/')) checkSpeciesOption(file, doc, route, rel, entries, articleByFile);
    if (route === 'species/edition.schema.json') checkParentOptionRegistration(file, doc, entries, species);
    strings(doc,(value,pointer)=>validateInline(value,pointer,file,registered));
  }
  for(const {file,route} of entries.values()) if((route==='faq/article.schema.json'||route==='species/options/faq-article.schema.json')&&!articleByFile.has(file)) error(file,'FAQ article not referenced by its edition FAQ index');
  for(const entry of warnings)console.warn(`WARN ${entry}`);
  for(const entry of errors)console.error(`ERROR ${entry}`);
  console.log(`Content validation: ${files.length} JSON files, ${errors.length} error(s), ${warnings.length} unresolved-link warning(s).`);
  if(errors.length)process.exitCode=1;
}
main().catch(e=>{console.error(`Validation failed: ${e.stack||e.message}`);process.exitCode=1;});
