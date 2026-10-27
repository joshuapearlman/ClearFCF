"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeManualForecast } = require("../public/financial-analysis/engine");

test("manual forecast cells survive rebuilds and a shorter then longer horizon", () => {
  const generated = [2027, 2028, 2029].map((year, index) => ({
    year, revenue: 110 + index * 10, revenueGrowth: 0.1, ebit: 20 + index,
    sources: { revenue: "Auto", revenueGrowth: "Auto", ebit: "Auto" }
  }));
  const saved = [{ ...generated[0], revenue: 125, ebit: 30,
    sources: { ...generated[0].sources, revenue: "User input", ebit: "User input" } }];
  const first = mergeManualForecast(generated, saved, {}, 100);
  assert.equal(first.forecast[0].revenue, 125);
  assert.equal(first.forecast[0].revenueGrowth, 0.25);
  assert.equal(first.forecast[0].ebit, 30);
  assert.equal(first.forecast[1].ebit, 21);

  const shorter = mergeManualForecast(generated.slice(0, 1), first.forecast, first.overrides, 100);
  const longer = mergeManualForecast(generated, shorter.forecast, shorter.overrides, 100);
  assert.equal(longer.forecast[0].revenue, 125);
  assert.equal(longer.forecast[0].ebit, 30);
  assert.equal(longer.overrides["2027"].revenue, 125);
});

test("manual growth input remains the source of revenue on rebuild", () => {
  const generated = [{ year: 2027, revenue: 110, revenueGrowth: 0.1, sources: {} }];
  const result = mergeManualForecast(generated, [], { 2027: { revenueGrowth: 0.2 } }, 100);
  assert.equal(result.forecast[0].revenue, 120);
  assert.equal(result.forecast[0].sources.revenueGrowth, "User input");
});
