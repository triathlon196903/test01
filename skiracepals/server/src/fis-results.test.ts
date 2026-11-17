import assert from "node:assert/strict";
import test from "node:test";
import { StartListError } from "./fis-live";
import { fisStartListPdfUrl, linesFromPdfItems, parseFisResultsPage, parseFisStartListLines } from "./fis-results";

const page = `
<div class="event-header__kind">Women's Giant Slalom</div>
<h3 class="heading heading_l3">start list</h3>
<a class="table-row" href="/bio">
  <div class="athlete-name">ROBINSON Alice</div>
  <span class="country__name-short">NZL</span>
</a>
<a class="table-row" href="/bio">
  <div class="athlete-name">HURT A J</div>
  <span class="country__name-short">USA</span>
</a>
<a class="table-row" href="/bio">
  <div class="athlete-name">DELLA MEA Lara</div>
  <span class="country__name-short">ITA</span>
</a>
<a class="table-row" href="/bio">
  <div class="athlete-name">O'BRIEN Nina</div>
  <span class="country__name-short">USA</span>
</a>
`;

test("the official race page is the start list, in bib order", () => {
  const list = parseFisResultsPage(page);
  assert.equal(list.gender, "W");
  assert.equal(list.discipline, "GS");
  assert.deepEqual(list.starters, [
    { name: "Alice Robinson", nation: "NZL" },
    { name: "A J Hurt", nation: "USA" },
    { name: "Lara della Mea", nation: "ITA" },
    { name: "Nina O'Brien", nation: "USA" },
  ]);
});

test("a slalom page titles the first-run start list", () => {
  const list = parseFisResultsPage(`
<div class="event-header__kind">Women's Slalom</div>
<h3 class="heading heading_l3">1st Run</h3>
<h3 class="heading heading_l3">start list first run</h3>
<div class="table-row">
  <div class="g-xs-24 justify-left athlete-name">AICHER Emma</div>
  <span class="country__name-short">GER</span>
</div>
<div class="table-row pointer">
  <div class="athlete-name">SHIFFRIN Mikaela</div>
  <span class="country__name-short">USA</span>
</div>
<h3 class="heading heading_l3">Sign up for FIS Newsletters</h3>
<div class="table-row"><div class="athlete-name">IGNORED Name</div><span class="country__name-short">SUI</span></div>
`);
  assert.equal(list.gender, "W");
  assert.equal(list.discipline, "SL");
  assert.deepEqual(list.starters, [
    { name: "Emma Aicher", nation: "GER" },
    { name: "Mikaela Shiffrin", nation: "USA" },
  ]);
});

test("the downloads tab prefers the first-run start list pdf", () => {
  const html = `
<div data-link="https://www.fis-ski.com/DB/v2/download/competition-attachment/second.pdf" data-ga-download="Start List 2nd run"></div>
<div data-link="https://www.fis-ski.com/DB/v2/download/competition-attachment/extended.pdf" data-ga-download="Extended start list"></div>
<div data-link="https://www.fis-ski.com/DB/v2/download/competition-attachment/first.pdf" data-ga-download="Start List 1st run"></div>
`;
  assert.equal(fisStartListPdfUrl(html), "https://www.fis-ski.com/DB/v2/download/competition-attachment/first.pdf");
  assert.equal(
    fisStartListPdfUrl(`<div data-link="https://www.fis-ski.com/DB/v2/download/competition-attachment/only.pdf" data-ga-download="Start List"></div>`),
    "https://www.fis-ski.com/DB/v2/download/competition-attachment/only.pdf",
  );
  assert.equal(fisStartListPdfUrl("<h3>official results</h3>"), null);
});

test("a pdf row keeps bib order and the printed name", () => {
  const line = linesFromPdfItems([
    { str: "NOEL Clement", transform: [0, 0, 0, 0, 174, 592] },
    { str: "1", transform: [0, 0, 0, 0, 123, 592] },
    { str: "FRA", transform: [0, 0, 0, 0, 374, 592] },
    { str: "1997", transform: [0, 0, 0, 0, 349, 592] },
    { str: "6190403", transform: [0, 0, 0, 0, 144, 592] },
    { str: "Dynastar", transform: [0, 0, 0, 0, 461, 592] },
    { str: "McGRATH Atle Lie", transform: [0, 0, 0, 0, 174, 560] },
    { str: "2", transform: [0, 0, 0, 0, 123, 560] },
    { str: "NOR", transform: [0, 0, 0, 0, 374, 560] },
    { str: "2000", transform: [0, 0, 0, 0, 349, 560] },
    { str: "422732", transform: [0, 0, 0, 0, 144, 560] },
    { str: "del CAMPO HERNANDEZ Juan", transform: [0, 0, 0, 0, 174, 540] },
    { str: "3", transform: [0, 0, 0, 0, 123, 540] },
    { str: "ESP", transform: [0, 0, 0, 0, 374, 540] },
    { str: "1994", transform: [0, 0, 0, 0, 349, 540] },
    { str: "491853", transform: [0, 0, 0, 0, 144, 540] },
    { str: "HURT A.J.", transform: [0, 0, 0, 0, 174, 520] },
    { str: "4", transform: [0, 0, 0, 0, 123, 520] },
    { str: "USA", transform: [0, 0, 0, 0, 374, 520] },
    { str: "2000", transform: [0, 0, 0, 0, 349, 520] },
    { str: "6536392", transform: [0, 0, 0, 0, 144, 520] },
  ]);
  assert.deepEqual(parseFisStartListLines([...line, "F1 - MAKSIMOV Felix FIN", "START LIST RUN 1"]), [
    { name: "Clement Noel", nation: "FRA" },
    { name: "Atle Lie McGrath", nation: "NOR" },
    { name: "Juan del Campo Hernandez", nation: "ESP" },
    { name: "A J Hurt", nation: "USA" },
  ]);
});

test("a start list with a missing bib is rejected", () => {
  assert.throws(
    () => parseFisStartListLines(["1 6190403 NOEL Clement 1997 FRA", "3 512182 MEILLARD Loic 1996 SUI"]),
    (error: unknown) => {
      assert.ok(error instanceof StartListError);
      assert.equal((error as StartListError).message, "The FIS start list could not be read");
      return true;
    },
  );
});

test("a results page without a start list is left alone", () => {
  assert.throws(() => parseFisResultsPage("<h3>Results</h3>"), (error: unknown) => {
    assert.ok(error instanceof StartListError);
    assert.equal((error as StartListError).message, "The official start list is not on the FIS page yet");
    return true;
  });
});
