import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildLeadDisplayModel, filterLeadDisplayModels } from "../public/uiState.js";

test("Leads page keeps primary actions visible before filters and list", () => {
  const html = readFileSync("public/index.html", "utf8");

  assert.equal(html.indexOf('id="show-import-leads"') < html.indexOf('id="lead-search"'), true);
  assert.equal(html.indexOf('id="show-add-lead"') < html.indexOf('id="lead-search"'), true);
  assert.equal(html.indexOf('id="lead-search"') < html.indexOf('id="lead-list"'), true);
  assert.equal(html.includes('id="intelligence-filter"'), true);
  assert.equal(html.includes('id="attention-filter"'), true);
});

test("Leads layout avoids competing detail-panel scrollbars", () => {
  const css = readFileSync("public/styles.css", "utf8");
  const detailPanelBlock = css.match(/\.detail-panel\s*\{[^}]+\}/)?.[0] || "";
  const leadBoardBlock = css.match(/\.lead-board\s*\{[^}]+\}/)?.[0] || "";
  const leadListBlock = css.match(/\.lead-list\s*\{[^}]+\}/)?.[0] || "";

  assert.equal(detailPanelBlock.includes("overflow: auto"), false);
  assert.equal(detailPanelBlock.includes("max-height"), false);
  assert.equal(leadBoardBlock.includes("height: calc"), false);
  assert.equal(leadBoardBlock.includes("overflow: hidden"), false);
  assert.equal(leadListBlock.includes("overflow: auto"), true);
});

test("normal product UI does not expose sandbox execution controls", () => {
  const html = readFileSync("public/index.html", "utf8");
  const app = readFileSync("public/app.js", "utf8");

  assert.equal(html.includes("Run sandbox execution"), false);
  assert.equal(html.includes("Prepare action"), false);
  assert.equal(html.includes("Mock n8n"), false);
  assert.equal(app.includes("Evidence references"), false);
  assert.equal(app.includes("Ready for deeper Lead Intelligence"), false);
});

test("Lead display models tolerate many leads and long content", () => {
  const leads = Array.from({ length: 120 }, (_, index) => ({
    id: `lead_${index}`,
    name: `Very Long Lead Name ${index} With Multiple Words And A Long Suffix`,
    company: `Long Company Name ${index}, With Comma And Additional Descriptive Text`,
    email: `long.person.${index}.with.extra.characters@example.com`,
    source: index % 2 === 0 ? "CSV" : "MANUAL",
    status: "NEW",
    actions: []
  }));

  const models = filterLeadDisplayModels(leads, { search: "company name 119" });
  const longModel = buildLeadDisplayModel(leads[119]);

  assert.equal(models.length, 1);
  assert.equal(models[0].id, "lead_119");
  assert.equal(longModel.company.includes("With Comma"), true);
  assert.equal(longModel.contact, "long.person.119.with.extra.characters@example.com");
});
