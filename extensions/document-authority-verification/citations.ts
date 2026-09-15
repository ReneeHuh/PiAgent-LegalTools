import type {
  AuthorityType,
  DocumentBlock,
  ExtractedCitationOccurrence,
  LoadedDocument,
} from "./types.ts";

const REPORTER = String.raw`(?:U\.?\s*S\.?|S\.?\s*Ct\.?|L\.?\s*Ed\.?(?:\s*2d)?|F\.?(?:\s*Supp\.?(?:\s*[23]d)?|\s*[234]th|\s*[23]d)?|N\.?\s*[EW]\.?(?:\s*[23]d)?|S\.?\s*[EW]\.?(?:\s*[23]d)?|A\.?(?:\s*[23]d)?|P\.?(?:\s*[23]d)?|So\.?(?:\s*[23]d)?|N\.?Y\.?(?:\s*S\.?)?(?:\s*[23]d)?|Mich\.?(?:\s*App\.?)?|Cal\.?(?:\s*App\.?)?(?:\s*\d+(?:th|d))?|Mass\.?|Ohio\s*St\.?(?:\s*\d+d)?|Ill\.?(?:\s*App\.?)?(?:\s*\d+d)?|Va\.?|W\.\s*Va\.?|Wis\.?(?:\s*\d+d)?|Minn\.?|Tex\.?(?:\s*App\.?)?|Ga\.?(?:\s*App\.?)?|Fla\.?(?:\s*App\.?)?|Pa\.?(?:\s*Super\.?)?|Md\.?(?:\s*App\.?)?|Wash\.?(?:\s*App\.?)?(?:\s*\d+d)?|Conn\.?(?:\s*App\.?)?|N\.?J\.?(?:\s*Super\.?)?|WL)`;

const FULL_REPORTER_RE = new RegExp(`\\b(\\d{1,4})\\s+(${REPORTER})\\s+(\\d{1,9})`, "g");
const SHORT_REPORTER_RE = new RegExp(`\\b(\\d{1,4})\\s+(${REPORTER})\\s+at\\s+(\\*?\\d{1,7}(?:[-–]\\d{1,7})?(?:\\s+n\\.?\\s*\\d+)?)`, "g");
const CASE_NAME_RE = /([A-Z][A-Za-z0-9&'’.,()\- ]{0,100}?\s+v\.?\s+[A-Z][A-Za-z0-9&'’.,()\- ]{1,100}?)\s*,?\s*$/;
const NAME_ONLY_RE = /\b([A-Z][A-Za-z0-9&'’.()\-]*(?:\s+[A-Z][A-Za-z0-9&'’.()\-]*){0,8}\s+v\.\s+[A-Z][A-Za-z0-9&'’.()\-]*(?:\s+[A-Z][A-Za-z0-9&'’.()\-]*){0,8})\b/g;
const ID_RE = /\b(?:Id\.|Ibid\.)\s*(?:at\s+(\*?\d{1,7}(?:[-–]\d{1,7})?))?/gi;
const STATUTE_RE = /\b(?:\d+\s+U\.?\s*S\.?\s*C\.?(?:\s*§+)?\s*[\w().–-]+|MCL\s+\d+[\w.()–-]*|[A-Z][A-Za-z. ]+\s+(?:Code|Laws?)\s*§+\s*[\w.()–-]+)/g;
const RULE_RE = /\b(?:Fed\.?\s+R\.?\s+(?:Civ|Crim|App)\.?\s+P\.?|[A-Z][A-Za-z. ]+\s+(?:Court\s+)?R(?:ule)?\.?)\s*\d+[\w.()–-]*/g;

interface PendingOccurrence extends Omit<ExtractedCitationOccurrence, "id"> {
  blockIndex: number;
}

function cleanReporter(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeReporterCitation(value: string): string | undefined {
  const match = new RegExp(`^\\s*(\\d{1,4})\\s+(${REPORTER})\\s+(\\d{1,9})\\s*$`, "i").exec(value);
  if (!match) return undefined;
  const reporter = match[2].toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${Number(match[1])}:${reporter}:${Number(match[3])}`;
}

export function reporterRoot(volume: string, reporter: string): string {
  return `${Number(volume)}:${reporter.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

export function normalizeCaseName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(?:in\s+re|ex\s+rel\.?|the)\b/g, " ")
    .replace(/\b(?:company|co|corporation|corp|incorporated|inc|limited|ltd)\b/g, " ")
    .replace(/\bversus\b/g, " v ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCaseName(text: string, citationStart: number): { name?: string; start: number } {
  const from = Math.max(0, citationStart - 230);
  let prefix = text.slice(from, citationStart).replace(/[*_]+/g, "");
  const boundary = Math.max(prefix.lastIndexOf(";"), prefix.lastIndexOf("\n"));
  if (boundary >= 0) {
    prefix = prefix.slice(boundary + 1);
  }
  const match = CASE_NAME_RE.exec(prefix);
  if (!match || match.index === undefined) return { start: citationStart };
  const name = match[1].replace(/\s+/g, " ").trim();
  return { name, start: citationStart - prefix.length + match.index };
}

function parseTail(text: string, coreEnd: number): { pincite?: string; parenthetical?: string; end: number } {
  const tail = text.slice(coreEnd, coreEnd + 180);
  let consumed = 0;
  let pincite: string | undefined;
  const pin = /^\s*,\s*(?:at\s+)?(\*?\d{1,7}(?:[-–]\d{1,7})?(?:\s+n\.?\s*\d+)?)(?=\s*(?:\([^\n)]*\)|[.;:]|$))/i.exec(tail);
  if (pin) {
    pincite = pin[1].trim();
    consumed = pin[0].length;
  }
  const afterPin = tail.slice(consumed);
  const parentheticalMatch = /^\s*(\([^\n)]{2,120}\))/.exec(afterPin);
  const parenthetical = parentheticalMatch?.[1];
  if (parentheticalMatch) consumed += parentheticalMatch[0].length;
  return { pincite, parenthetical, end: coreEnd + consumed };
}

function citedYear(parenthetical?: string): string | undefined {
  if (!parenthetical) return undefined;
  return [...parenthetical.matchAll(/\b(?:18|19|20)\d{2}\b/g)].at(-1)?.[0];
}

function quotationBefore(text: string, citationStart: number): string | undefined {
  const prefixStart = Math.max(0, citationStart - 1_500);
  const prefix = text.slice(prefixStart, citationStart);
  const matches = [...prefix.matchAll(/[“"]([^“”"\n]{5,1200})[”"]/g)];
  const match = matches.at(-1);
  if (!match || match.index === undefined) return undefined;
  const end = match.index + match[0].length;
  if (prefix.length - end > 450) return undefined;
  return match[1].replace(/\s+/g, " ").trim();
}

function propositionAround(text: string, start: number, end: number): string {
  const previous = Math.max(text.lastIndexOf(". ", start - 1), text.lastIndexOf("? ", start - 1), text.lastIndexOf("! ", start - 1));
  const followingCandidates = [text.indexOf(". ", end), text.indexOf("? ", end), text.indexOf("! ", end)]
    .filter((value) => value >= 0);
  const following = followingCandidates.length ? Math.min(...followingCandidates) + 1 : text.length;
  const sentence = text.slice(previous < 0 ? 0 : previous + 2, following).replace(/\s+/g, " ").trim();
  return sentence || text.replace(/\s+/g, " ").trim();
}

function overlaps(start: number, end: number, pending: PendingOccurrence[]): boolean {
  return pending.some((item) => start < item.end && end > item.start);
}

function pushUnsupported(
  pending: PendingOccurrence[],
  block: DocumentBlock,
  blockIndex: number,
  regex: RegExp,
  authorityType: AuthorityType,
): void {
  regex.lastIndex = 0;
  for (let match = regex.exec(block.text); match; match = regex.exec(block.text)) {
    if (match.index === undefined || overlaps(match.index, match.index + match[0].length, pending)) continue;
    pending.push({
      kind: "unsupported",
      authorityType,
      rawCitation: match[0],
      documentBlock: block.id,
      proposition: propositionAround(block.text, match.index, match.index + match[0].length),
      start: match.index,
      end: match.index + match[0].length,
      blockIndex,
    });
  }
}

function extractBlock(block: DocumentBlock, blockIndex: number): PendingOccurrence[] {
  const pending: PendingOccurrence[] = [];
  FULL_REPORTER_RE.lastIndex = 0;
  for (let match = FULL_REPORTER_RE.exec(block.text); match; match = FULL_REPORTER_RE.exec(block.text)) {
    if (match.index === undefined) continue;
    const tail = parseTail(block.text, match.index + match[0].length);
    const foundName = extractCaseName(block.text, match.index);
    const reporterCitation = `${match[1]} ${cleanReporter(match[2])} ${match[3]}`;
    const rawCitation = block.text.slice(foundName.start, tail.end).trim().replace(/^[,*_\s]+|[*_\s]+$/g, "");
    pending.push({
      kind: "full",
      authorityType: "case",
      rawCitation,
      caseName: foundName.name,
      reporterCitation,
      normalizedCitation: normalizeReporterCitation(reporterCitation),
      reporterRoot: reporterRoot(match[1], match[2]),
      volume: match[1],
      reporter: cleanReporter(match[2]),
      firstPage: match[3],
      pincite: tail.pincite,
      parenthetical: tail.parenthetical,
      citedYear: citedYear(tail.parenthetical),
      documentBlock: block.id,
      proposition: propositionAround(block.text, foundName.start, tail.end),
      quotation: quotationBefore(block.text, foundName.start),
      start: foundName.start,
      end: tail.end,
      blockIndex,
    });
  }

  SHORT_REPORTER_RE.lastIndex = 0;
  for (let match = SHORT_REPORTER_RE.exec(block.text); match; match = SHORT_REPORTER_RE.exec(block.text)) {
    if (match.index === undefined || overlaps(match.index, match.index + match[0].length, pending)) continue;
    pending.push({
      kind: "short_form",
      authorityType: "case",
      rawCitation: match[0],
      reporterRoot: reporterRoot(match[1], match[2]),
      volume: match[1],
      reporter: cleanReporter(match[2]),
      pincite: match[3],
      documentBlock: block.id,
      proposition: propositionAround(block.text, match.index, match.index + match[0].length),
      quotation: quotationBefore(block.text, match.index),
      start: match.index,
      end: match.index + match[0].length,
      blockIndex,
    });
  }

  ID_RE.lastIndex = 0;
  for (let match = ID_RE.exec(block.text); match; match = ID_RE.exec(block.text)) {
    if (match.index === undefined || overlaps(match.index, match.index + match[0].length, pending)) continue;
    pending.push({
      kind: "id",
      authorityType: "case",
      rawCitation: match[0],
      pincite: match[1],
      documentBlock: block.id,
      proposition: propositionAround(block.text, match.index, match.index + match[0].length),
      quotation: quotationBefore(block.text, match.index),
      start: match.index,
      end: match.index + match[0].length,
      blockIndex,
    });
  }

  NAME_ONLY_RE.lastIndex = 0;
  for (let match = NAME_ONLY_RE.exec(block.text); match; match = NAME_ONLY_RE.exec(block.text)) {
    if (match.index === undefined || overlaps(match.index, match.index + match[0].length, pending)) continue;
    const after = block.text.slice(match.index + match[0].length, match.index + match[0].length + 80);
    if (new RegExp(`^\\s*,?\\s*\\d{1,4}\\s+${REPORTER}\\s+\\d`, "i").test(after)) continue;
    pending.push({
      kind: "name_only",
      authorityType: "case",
      rawCitation: match[0],
      caseName: match[1],
      documentBlock: block.id,
      proposition: propositionAround(block.text, match.index, match.index + match[0].length),
      quotation: quotationBefore(block.text, match.index),
      start: match.index,
      end: match.index + match[0].length,
      blockIndex,
    });
  }

  pushUnsupported(pending, block, blockIndex, STATUTE_RE, "statute");
  pushUnsupported(pending, block, blockIndex, RULE_RE, "rule");
  return pending;
}

function linkShortForms(occurrences: ExtractedCitationOccurrence[]): void {
  for (let index = 0; index < occurrences.length; index += 1) {
    const item = occurrences[index];
    if (item.authorityType !== "case" || item.kind === "full" || item.kind === "name_only") continue;
    const prior = occurrences.slice(0, index).reverse().find((candidate) => {
      if (item.kind === "id") return true;
      if (candidate.authorityType !== "case") return false;
      return Boolean(item.reporterRoot && candidate.reporterRoot === item.reporterRoot);
    });
    if (prior) {
      item.linkedOccurrenceId = prior.id;
      if (item.kind === "id") item.authorityType = prior.authorityType;
    }
  }
}

export function extractCitationOccurrences(document: LoadedDocument): ExtractedCitationOccurrence[] {
  const pending = document.blocks.flatMap((block, index) => extractBlock(block, index));
  pending.sort((left, right) => left.blockIndex - right.blockIndex || left.start - right.start || left.end - right.end);
  const occurrences = pending.map(({ blockIndex: _blockIndex, ...item }, index) => ({
    ...item,
    id: `C${String(index + 1).padStart(4, "0")}`,
  }));
  linkShortForms(occurrences);
  return occurrences;
}
