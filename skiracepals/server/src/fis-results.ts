import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { formatFisPerson, StartListError, type DrawnStarter, type FisDraw } from "./fis-live";

const readError = "The FIS start list could not be read";
const missingError = "The official start list is not on the FIS page yet";

/** The public race page prints the start list as LASTNAME Firstname. */
export function parseFisResultsPage(html: string): FisDraw {
  const kind = html.match(/class="event-header__kind">\s*([^<]+?)\s*</)?.[1] ?? "";
  const heading = html.search(/<h3[^>]*>\s*start list(?:\s+[^<]*)?\s*<\/h3>/i);
  if (heading < 0) throw new StartListError(missingError);
  const afterHeading = html.slice(heading);
  const headingEnd = afterHeading.indexOf("</h3>");
  const section = headingEnd < 0 ? afterHeading : afterHeading.slice(headingEnd + 5);
  const nextHeading = section.search(/<h3\b/i);
  const table = nextHeading < 0 ? section : section.slice(0, nextHeading);
  const starters = table
    .split(/class="table-row(?:\s[^"]*)?"/)
    .slice(1)
    .map((row) => {
      const name = row.match(/athlete-name">\s*([^<]+?)\s*</);
      const nation = row.match(/country__name-short">\s*([A-Z]{3})\s*</);
      if (!name || !nation) throw new StartListError(readError);
      return { name: officialName(name[1]), nation: nation[1] };
    });
  if (starters.length === 0) throw new StartListError(missingError);
  return { gender: fieldGender(kind), discipline: fieldDiscipline(kind), starters };
}

/** The downloads tab labels the first-run start list PDF. A plain "Start List" is the single-run fallback. */
export function fisStartListPdfUrl(html: string): string | null {
  let plain: string | null = null;
  for (const mark of html.matchAll(/data-ga-download="([^"]*)"/gi)) {
    const label = mark[1].trim().toLowerCase();
    const firstRun = label === "start list 1st run";
    if (!firstRun && label !== "start list") continue;
    const at = mark.index ?? 0;
    const around = html.slice(Math.max(0, at - 800), at + mark[0].length);
    const links = [...around.matchAll(/data-link="(https:\/\/www\.fis-ski\.com\/[^"]+\.pdf)"/gi)];
    const link = links.at(-1)?.[1]?.replace(/&amp;/g, "&");
    if (!link) continue;
    if (firstRun) return link;
    plain ??= link;
  }
  return plain;
}

/** One start-list PDF row is bib, FIS code, LASTNAME Firstname, year, nation. */
export function parseFisStartListLines(lines: string[]): DrawnStarter[] {
  const starters: { bib: number; starter: DrawnStarter }[] = [];
  for (const line of lines) {
    const match = line.match(/^(\d{1,3})\s+(\d{4,8})\s+(.+?)\s+((?:19|20)\d{2})\s+([A-Z]{3})\b/);
    if (!match) continue;
    starters.push({ bib: Number(match[1]), starter: { name: officialName(match[3]), nation: match[5] } });
  }
  if (starters.length === 0) throw new StartListError(missingError);
  const bibs = starters.map((item) => item.bib).sort((a, b) => a - b);
  const contiguous = bibs[0] === 1 && bibs.every((bib, index) => bib === index + 1);
  if (new Set(bibs).size !== bibs.length || !contiguous) throw new StartListError(readError);
  return starters.sort((a, b) => a.bib - b.bib).map((item) => item.starter);
}

type PdfTextItem = { str: string; transform: number[] };

export function linesFromPdfItems(items: PdfTextItem[]): string[] {
  const rows: { y: number; parts: { x: number; str: string }[] }[] = [];
  for (const item of items) {
    const str = item.str.trim();
    if (!str || item.transform.length < 6) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    const row = rows.find((candidate) => Math.abs(candidate.y - y) < 2);
    if (row) row.parts.push({ x, str });
    else rows.push({ y, parts: [{ x, str }] });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) =>
      row.parts
        .sort((a, b) => a.x - b.x)
        .map((part) => part.str)
        .join(" "),
    );
}

export async function fetchFisStartList(fisRaceId: number): Promise<FisDraw> {
  if (!Number.isInteger(fisRaceId) || fisRaceId <= 0) throw new StartListError("This race has no FIS race id");
  const html = await fetchRacePage(fisRaceId);
  try {
    return parseFisResultsPage(html);
  } catch (error) {
    if (!(error instanceof StartListError)) throw error;
    const pdfUrl = fisStartListPdfUrl(html);
    if (!pdfUrl) throw error;
    const starters = await parseFisStartListPdf(await fetchPdf(pdfUrl));
    const kind = html.match(/class="event-header__kind">\s*([^<]+?)\s*</)?.[1] ?? "";
    return { gender: fieldGender(kind), discipline: fieldDiscipline(kind), starters };
  }
}

async function fetchRacePage(fisRaceId: number): Promise<string> {
  const target = `https://www.fis-ski.com/DB/general/results.html?sectorcode=AL&raceid=${fisRaceId}`;
  let response: Response;
  try {
    response = await fetch(target, {
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
      headers: { accept: "text/html" },
    });
  } catch {
    throw new StartListError(readError);
  }
  if (response.status !== 200) throw new StartListError(readError);
  const html = await response.text();
  if (html.length > 3_000_000 || !html.includes(`raceid=${fisRaceId}`)) throw new StartListError(readError);
  return html;
}

async function fetchPdf(url: string): Promise<Uint8Array> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "www.fis-ski.com") throw new StartListError(readError);
  let response: Response;
  try {
    response = await fetch(parsed, {
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
      headers: { accept: "application/pdf" },
    });
  } catch {
    throw new StartListError(readError);
  }
  if (response.status !== 200) throw new StartListError(readError);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const header = String.fromCharCode(...bytes.slice(0, 5));
  if (bytes.length > 8_000_000 || header !== "%PDF-") throw new StartListError(readError);
  return bytes;
}

async function parseFisStartListPdf(data: Uint8Array): Promise<DrawnStarter[]> {
  const document = await getDocument({ data }).promise;
  const lines: string[] = [];
  for (let number = 1; number <= document.numPages; number += 1) {
    const page = await document.getPage(number);
    const content = await page.getTextContent();
    const items = content.items.flatMap((item) =>
      typeof item === "object" && item !== null && "str" in item && "transform" in item
        ? [{ str: String(item.str), transform: [...item.transform] }]
        : [],
    );
    lines.push(...linesFromPdfItems(items));
  }
  return parseFisStartListLines(lines);
}

function isGivenName(token: string): boolean {
  if (/^\p{Lu}$/u.test(token)) return true;
  return token.split("-").every((part) => /^\p{Lu}\p{Ll}+$/u.test(part));
}

function officialName(raw: string): string {
  const tokens = raw.replace(/\./g, " ").replace(/\s+/g, " ").trim().split(" ");
  const splitAt = tokens.findIndex(isGivenName);
  if (splitAt <= 0) throw new StartListError(readError);
  return formatFisPerson(tokens.slice(splitAt).join(" "), tokens.slice(0, splitAt).join(" "));
}

function fieldGender(kind: string): "W" | "M" | null {
  if (/women|ladies/i.test(kind)) return "W";
  if (/\bmen\b/i.test(kind)) return "M";
  return null;
}

function fieldDiscipline(kind: string): FisDraw["discipline"] {
  if (/giant slalom/i.test(kind)) return "GS";
  if (/super-?\s*g/i.test(kind)) return "SG";
  if (/downhill/i.test(kind)) return "DH";
  if (/combined/i.test(kind)) return "AC";
  if (/slalom/i.test(kind)) return "SL";
  return null;
}
