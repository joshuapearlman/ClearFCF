"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const dcf = require("../dcf-public/engine");

test("EBIT method calculates unlevered FCFF", () => {
  const result = dcf.calculateFcffYear({ ebit: 100, taxRate: 0.25, dna: 20, capex: 30, changeInNwc: 5 });
  assert.equal(result.nopat, 75);
  assert.equal(result.fcff, 60);
  assert.equal(result.ebitda, 120);
});

test("WACC uses market-value capital weights and after-tax debt cost", () => {
  const result = dcf.calculateWacc({
    riskFreeRate: 0.04,
    beta: 1.2,
    equityRiskPremium: 0.05,
    additionalPremium: 0,
    preTaxCostOfDebt: 0.06,
    taxRate: 0.25,
    equityValue: 800,
    debtValue: 200,
    mode: "calculated"
  });
  assert.ok(Math.abs(result.costOfEquity - 0.10) < 1e-12);
  assert.ok(Math.abs(result.afterTaxCostOfDebt - 0.045) < 1e-12);
  assert.ok(Math.abs(result.wacc - 0.089) < 1e-12);
});

test("perpetuity terminal value rejects growth at or above WACC", () => {
  const result = dcf.terminalValue({ fcff: 100 }, { method: "perpetuity", growthRate: 0.09 }, 0.09);
  assert.equal(result.value, null);
  assert.match(result.error, /greater/);
});

test("DCF discounts forecast and bridges enterprise value to share price", () => {
  const model = {
    forecast: [1, 2, 3, 4, 5].map((year) => ({ year, ebit: 100, taxRate: 0.20, dna: 10, capex: 10, changeInNwc: 0 })),
    wacc: { mode: "manual", manualWacc: 0.10 },
    terminal: { method: "perpetuity", growthRate: 0.02 }
  };
  const result = dcf.calculateCase(model, { cash: 50, debt: 100, shares: 10, currentPrice: 80 });
  assert.equal(result.years[0].fcff, 80);
  assert.ok(result.enterpriseValue > 900 && result.enterpriseValue < 1100);
  assert.ok(result.impliedSharePrice > 85 && result.impliedSharePrice < 105);
  assert.ok(result.terminalShare > 0.5);
});

test("automatic cases produce ordered revenue paths", () => {
  const history = [
    { year: 2025, revenue: 121, ebit: 24.2, effectiveTaxRate: 0.21, dna: 4, capex: 5, changeInNwc: 1 },
    { year: 2024, revenue: 110, ebit: 22, effectiveTaxRate: 0.21, dna: 4, capex: 5, changeInNwc: 1 },
    { year: 2023, revenue: 100, ebit: 20, effectiveTaxRate: 0.21, dna: 4, capex: 5, changeInNwc: 1 }
  ];
  const bear = dcf.autoForecast(history, 5, "bear");
  const base = dcf.autoForecast(history, 5, "base");
  const bull = dcf.autoForecast(history, 5, "bull");
  assert.equal(base.length, 5);
  assert.ok(bear.at(-1).revenue < base.at(-1).revenue);
  assert.ok(base.at(-1).revenue < bull.at(-1).revenue);
});

test("automatic forecast builds operating NWC from its five disclosed components", () => {
  const history = [
    { year: 2025, revenue: 100, ebit: 15, dna: 4, capex: 5, accountsReceivable: 10, inventory: 8, prepaidExpenses: 2, accountsPayable: 7, accruedExpenses: 3, netWorkingCapital: 10 },
    { year: 2024, revenue: 90, ebit: 13, dna: 4, capex: 5, accountsReceivable: 9, inventory: 7.2, prepaidExpenses: 1.8, accountsPayable: 6.3, accruedExpenses: 2.7, netWorkingCapital: 9 }
  ];
  const forecast = dcf.autoForecastWithDrivers(history, 2, "base", {
    revenueMethod: "latest",
    accountsReceivableMargin: 0.10,
    inventoryMargin: 0.08,
    prepaidExpensesMargin: 0.02,
    accountsPayableMargin: 0.07,
    accruedExpensesMargin: 0.03
  });
  for (const row of forecast) {
    assert.ok(Math.abs(row.operatingCurrentAssets - (row.accountsReceivable + row.inventory + row.prepaidExpenses)) < 1e-10);
    assert.ok(Math.abs(row.operatingCurrentLiabilities - (row.accountsPayable + row.accruedExpenses)) < 1e-10);
    assert.ok(Math.abs(row.netWorkingCapital - (row.operatingCurrentAssets - row.operatingCurrentLiabilities)) < 1e-10);
  }
  assert.ok(Math.abs(forecast[0].changeInNwc - (forecast[0].netWorkingCapital - 10)) < 1e-10);
  assert.ok(Math.abs(forecast[1].changeInNwc - (forecast[1].netWorkingCapital - forecast[0].netWorkingCapital)) < 1e-10);
});

test("explicit forecast drivers select different revenue and margin methods", () => {
  const history = [
    { year: 2025, revenue: 160, ebit: 32, effectiveTaxRate: 0.21, dna: 6, capex: 7, changeInNwc: 1 },
    { year: 2024, revenue: 120, ebit: 18, effectiveTaxRate: 0.21, dna: 5, capex: 6, changeInNwc: 1 },
    { year: 2023, revenue: 110, ebit: 11, effectiveTaxRate: 0.21, dna: 5, capex: 6, changeInNwc: 1 },
    { year: 2022, revenue: 100, ebit: 10, effectiveTaxRate: 0.21, dna: 4, capex: 5, changeInNwc: 1 }
  ];
  const latest = dcf.autoForecastWithDrivers(history, 3, "base", { revenueMethod: "latest", ebitMarginMethod: "latest" });
  const cagr = dcf.autoForecastWithDrivers(history, 3, "base", { revenueMethod: "cagr5", ebitMarginMethod: "average5" });
  assert.ok(latest[0].revenue > cagr[0].revenue);
  assert.ok(latest[0].ebit / latest[0].revenue > cagr[0].ebit / cagr[0].revenue);
});

test("fade method reaches the selected long-run growth and margin targets", () => {
  const history = [
    { year: 2025, revenue: 121, ebit: 24.2, effectiveTaxRate: 0.21, dna: 4, capex: 5, changeInNwc: 1 },
    { year: 2024, revenue: 110, ebit: 19.8, effectiveTaxRate: 0.21, dna: 4, capex: 5, changeInNwc: 1 },
    { year: 2023, revenue: 100, ebit: 16, effectiveTaxRate: 0.21, dna: 4, capex: 5, changeInNwc: 1 }
  ];
  const forecast = dcf.autoForecastWithDrivers(history, 5, "base", {
    revenueMethod: "fade", terminalRevenueGrowth: 0.03,
    ebitMarginMethod: "fade", terminalEbitMargin: 0.25
  });
  assert.ok(Math.abs(forecast.at(-1).revenueGrowth - 0.03) < 1e-12);
  assert.ok(Math.abs(forecast.at(-1).ebit / forecast.at(-1).revenue - 0.25) < 1e-12);
});

test("walk-forward backtest reports error and bias without using future years", () => {
  const history = [
    { year: 2025, revenue: 146.41, ebit: 29.282 },
    { year: 2024, revenue: 133.1, ebit: 26.62 },
    { year: 2023, revenue: 121, ebit: 24.2 },
    { year: 2022, revenue: 110, ebit: 22 },
    { year: 2021, revenue: 100, ebit: 20 }
  ];
  const result = dcf.backtestForecast(history, { revenueMethod: "latest", ebitMarginMethod: "latest" });
  assert.equal(result.results.length, 2);
  assert.ok(result.revenueMape < 1e-10);
  assert.ok(result.ebitMape < 1e-10);
});
