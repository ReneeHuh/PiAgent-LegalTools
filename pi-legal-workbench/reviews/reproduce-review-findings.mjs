// Offline review diagnostics. Synthetic authorities only; no provider or model calls.
// Run from any directory: node reviews/reproduce-review-findings.mjs
// Temporary fixtures are retained at the printed path for inspection.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeSummary, saveSummaryOutput } from '../extensions/case-summarizer/output.ts';
import { validateCaseAnswer } from '../extensions/case-chat/output.ts';
import { loadCaseSource } from '../extensions/case-summarizer/source.ts';
import { runCaseSummarizer } from '../extensions/case-summarizer/summarize.ts';
import { runDocumentAuthorityVerification as verify } from '../extensions/document-authority-verification/verify.ts';
import { buildCaseSourceIndex } from '../extensions/document-authority-verification/sources.ts';
import { extractCitationOccurrences } from '../extensions/document-authority-verification/citations.ts';
import { writeTextAtomic, normalizeProviderResult } from '../extensions/legal-case-research/core.ts';
import { runLegalSearch } from '../extensions/legal-case-research/session-search.ts';
import { runLegalCitedBy, citationCollectionDirectory } from '../extensions/legal-case-research/library-cited-by.ts';
import { uniformJurisdiction } from '../extensions/legal-case-research/providers.ts';

const root = mkdtempSync(join(tmpdir(), 'pi-legal-review-'));
const evidence = { fixtureRoot: root, observations: {} };
const put = (path, value) => writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2), 'utf8');
const record = async (name, task) => {
  try { evidence.observations[name] = await task(); }
  catch (error) { evidence.observations[name] = { diagnosticError: String(error.stack ?? error) }; }
};
const filler = 'This synthetic opinion is a software fixture and is not a real legal authority. '.repeat(5);
const quotation = 'The law requires reasonable care under these circumstances.';
const ctx = { cwd: root };
function source(name, title, citation, body) {
  const path = join(root, name + '.txt');
  const meta = join(root, name + '-metadata.md');
  put(path, `${title}\n\n${body}\n\n${filler}`);
  put(meta, '```json\n' + JSON.stringify({ case: { title, citations: [citation], year: '2024' }, source: { provider: 'test' } }) + '\n```');
  return { source_path: path, metadata_path: meta };
}
const smith = source('smith', 'Smith v. Jones', '123 F.3d 456', quotation);
const adams = source('adams', 'Adams v. Baker', '123 F.3d 800', quotation);
async function checkDraft(name, draft, checks, sources = [smith], context = ctx) {
  const document_path = join(root, name + '.md');
  put(document_path, draft);
  return (await verify({ document_path, checks, case_sources: sources }, undefined, undefined, context)).details;
}
const compact = details => ({ counts: details.counts, results: details.results.map(r => ({
  citation: r.occurrence.raw, occurrence: r.occurrence.id, linked: r.occurrence.linkedOccurrenceId,
  identity: r.identity, quotation: r.quotation, pincite: r.pincite,
  proposition: r.propositionSupport, overall: r.overallStatus,
})) });
function modelContext(payload) {
  return { cwd: root, model: { provider: 'offline', id: 'fixture', maxTokens: 10000, contextWindow: 200000 },
    modelRegistry: { hasConfiguredAuth: () => true, complete: async () => ({ content: [{ type: 'text', text: JSON.stringify(typeof payload === 'function' ? payload() : payload) }], stopReason: 'stop', usage: {} }) } };
}

await record('wrong_reporter_accepted', async () => compact(await checkDraft('wrong-reporter', `"${quotation}" Smith v. Jones, 999 F.3d 999 (2024).`, ['citation_identity', 'quotation'])));
await record('wrong_short_form_target', async () => compact(await checkDraft('short-form', 'Smith v. Jones, 123 F.3d 456 (2024).\n\nAdams v. Baker, 123 F.3d 800 (2024).\n\nSmith, 123 F.3d at 461.', ['citation_identity'], [smith, adams])));
await record('preceding_paragraph_quote_skipped', async () => compact(await checkDraft('separate-quote', '"This fabricated quotation does not occur in the source."\n\nSmith v. Jones, 123 F.3d 456 (2024).', ['citation_identity', 'quotation'])));
await record('following_page_marker_accepted', async () => {
  const paged = source('paged', 'Smith v. Jones', '123 F.3d 456', `[123 F.3d 460] ${quotation} [123 F.3d 461] Later page content.`);
  return compact(await checkDraft('wrong-page', `"${quotation}" Smith v. Jones, 123 F.3d 456, 461 (2024).`, ['citation_identity', 'quotation', 'pincite'], [paged]));
});
await record('qualification_masks_incomplete_check', async () => compact(await checkDraft('qualified', `"${quotation}" Smith v. Jones, 123 F.3d 456, 461 (2024).`, ['citation_identity', 'quotation', 'pincite', 'proposition_support'], [smith], modelContext({ schema_version: 1, findings: [{ occurrence_id: 'C0001', proposition_support: { status: 'supports_with_qualification', explanation: 'Synthetic qualified conclusion.', source_blocks: ['P00002'], evidence_quote: quotation } }] }))));
await record('text_source_not_scanned', async () => {
  const directory = join(root, 'txt-library'); mkdirSync(directory);
  put(join(directory, 'opinion.txt'), `Smith v. Jones\n123 F.3d 456 (2024)\n\n${quotation}\n\n${filler}`);
  const index = await buildCaseSourceIndex({ cwd: root, sourceRoots: [directory] });
  return { sourceCount: index.sources?.length, index };
});

const stitchedSource = source('stitched', 'Smith v. Jones', '123 F.3d 456', 'The defendant is\n\nnot\n\nliable for the injuries.');
const loaded = await loadCaseSource({ cwd: root, sourcePath: stitchedSource.source_path, metadataPath: stitchedSource.metadata_path });
const identity = { name: 'Smith v. Jones', court: null, date: null, docket: null, citations: ['123 F.3d 456'] };
const summary = { schema_version: 1, case_identity: identity, ...Object.fromEntries(['executive_summary', 'procedural_posture', 'material_facts', 'issues', 'rules', 'holdings', 'reasoning', 'disposition', 'separate_opinions', 'limitations'].map(k => [k, []])), key_quotes: [{ text: 'The defendant is liable for the injuries.', source_blocks: ['P00002', 'P00004'], speaker: 'court', opinion_part: 'majority' }], treatment_status: 'not_checked' };
await record('stitched_summary_and_chat_quotes_accepted', async () => ({ sourceBlocks: loaded.blocks, summary: finalizeSummary(summary, loaded), chat: validateCaseAnswer({ answer: [], limitations: [], relevant_passages: [{ quote: summary.key_quotes[0].text, source_blocks: ['P00002', 'P00004'] }] }, loaded) }));
await record('stitched_verifier_evidence_accepted', async () => compact(await checkDraft('stitched-evidence', 'The defendant is liable for the injuries. Smith v. Jones, 123 F.3d 456 (2024).', ['citation_identity', 'proposition_support'], [stitchedSource], modelContext({ schema_version: 1, findings: [{ occurrence_id: 'C0001', proposition_support: { status: 'supports', explanation: 'Synthetic model conclusion reverses the source.', source_blocks: ['P00002', 'P00004'], evidence_quote: summary.key_quotes[0].text } }] }))));
await record('summary_json_provenance_missing', async () => {
  const path = await saveSummaryOutput(root, 'summary.json', summary, 'Markdown with provenance');
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  return { keys: Object.keys(saved), source: saved.source ?? null, audit: saved.audit ?? null };
});
await record('summary_save_failure_after_five_calls', async () => {
  let calls = 0;
  const context = modelContext(() => ++calls === 4 ? { disagreements: [], findings: [], required_corrections: [] } : summary);
  try { await runCaseSummarizer({ ...stitchedSource, output_path: 'summary.json' }, undefined, undefined, context); return { unexpectedSuccess: true, calls }; }
  catch (error) { return { calls, error: error.message, resultReturned: false }; }
});
await record('atomic_writer_replaces_original', async () => {
  const path = join(root, 'original.html'); put(path, 'ORIGINAL'); writeTextAtomic(path, 'REPLACEMENT');
  return { before: 'ORIGINAL', after: readFileSync(path, 'utf8') };
});

const cases = join(root, 'Cases'); mkdirSync(cases);
const raw = { title: 'Seed v. Case', meta: '123 F.3d 456 - 6th Circuit, 2024', snippet: 'Synthetic', caseId: '1', url: 'https://scholar.google.com/scholar_case?case=1&hl=en' };
const seed = normalizeProviderResult('scholar', raw, 'search');
seed.sources[0].citedById = '1';
const seedHtml = join(cases, 'seed.html');
put(seedHtml, '');
put(join(cases, 'seed.md'), '```json\n' + JSON.stringify({ case: seed, downloadedAt: '2020-01-01T00:00:00.000Z', source: { provider: 'scholar', savedPath: seedHtml, htmlSha256: 'old-content-hash' } }) + '\n```');
await record('empty_cached_opinion_counted_downloaded', async () => {
  let downloads = 0;
  const result = await runLegalSearch({ search_term: 'synthetic fixture', provider: 'scholar', jurisdiction: 'all', max_cases_to_download: 1, pages_to_search: 1 }, undefined, undefined, ctx, { now: () => 1000, search: async () => ({ results: [raw], reachedEnd: true }), download: async () => { downloads++; throw new Error('Unexpected download'); } });
  return { downloads, fileBytes: readFileSync(seedHtml).length, results: result.results, downloadSummary: result.downloadSummary };
});
await record('completed_cited_by_cannot_refresh_and_missing_file_counted', async () => {
  const directory = citationCollectionDirectory(ctx, seed); mkdirSync(directory, { recursive: true });
  const manifestPath = join(directory, 'cited-by-manifest.json');
  const oldDate = '2020-01-01T00:00:00.000Z';
  const citing = { ...seed, canonicalKey: 'citing--2', title: 'Citing v. Case', sources: [{ ...seed.sources[0], providerId: '2' }] };
  put(manifestPath, { schemaVersion: 2, mode: 'cited_by', requestFingerprint: 'saved', createdAt: oldDate, updatedAt: oldDate, status: 'complete', seed, requestedProviders: ['scholar'], filters: {}, providers: { scholar: { kind: 'scholar', status: 'exhausted', citedById: '1', partitions: [], completedPartitions: 1, pagesCompleted: 1, rawResults: 1, partitioned: false, expandedPartitions: [] } }, rawResults: 1, recordCount: 1, resultsFile: 'cited-by-results.json', journalFile: 'cited-by-events.jsonl', reportFiles: [], downloadLimit: 1 });
  put(join(directory, 'cited-by-events.jsonl'), JSON.stringify({ eventId: 'scholar:root:offset:0', provider: 'scholar', records: [citing] }) + '\n');
  const missing = join(directory, 'missing.html');
  put(join(directory, 'downloads.json'), [{ case: citing, status: 'downloaded', saved: { provider: 'scholar', savedPath: missing } }]);
  let collectError;
  try { await runLegalCitedBy({ action: 'collect', case_key: seed.canonicalKey }, undefined, undefined, ctx); }
  catch (error) { collectError = error.message; }
  const outcome = await runLegalCitedBy({ action: 'resume', case_key: seed.canonicalKey }, undefined, undefined, ctx);
  return { collectError, oldUpdatedAt: oldDate, newUpdatedAt: JSON.parse(readFileSync(manifestPath, 'utf8')).updatedAt, status: outcome.status, providerCorpusComplete: outcome.providerCorpusComplete, downloadedCases: outcome.downloadedCases, actualDownloadedFileExists: existsSync(missing) };
});
await record('michigan_inventory_and_scopes', async () => {
  const text = 'MCR 2.116(C)(10). MRE 401. Const 1963, art 1, section 17.';
  return { text, occurrences: extractCitationOccurrences({ path: 'draft.md', normalizedText: text, blocks: [{ id: 'D00001', text }] }), scopes: ['michigan', '6th circuit', 'eastern district of michigan', 'western district of michigan', 'us supreme court'].map(scope => uniformJurisdiction(scope)) };
});
console.log(JSON.stringify(evidence, null, 2));
