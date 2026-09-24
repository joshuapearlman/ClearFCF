(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ClearFcfDcf = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const finite = (value) => value !== null && value !== "" && Number.isFinite(Number(value));
  const number = (value, fallback = 0) => finite(value) ? Number(value) : fallback;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function average(values) {
    const usable = values.filter(finite).map(Number);
    return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
  }

  function median(values) {
    const usable = values.filter(finite).map(Number).sort((a, b) => a - b);
    if (!usable.length) return null;
    const middle = Math.floor(usable.length / 2);
    return usable.length % 2 ? usable[middle] : (usable[middle - 1] + usable[middle]) / 2;
  }

  function cagr(rows, years) {
    const usable = (rows || []).filter((row) => finite(row.revenue) && number(row.revenue) > 0).slice(0, years);
    const latest = usable[0];
    const oldest = usable.at(-1);
    const elapsed = number(latest?.year) - number(oldest?.year);
    return latest && oldest && elapsed > 0 ? (number(latest.revenue) / number(oldest.revenue)) ** (1 / elapsed) - 1 : null;
  }

  function historicalGrowthRates(rows, maxYears = 5) {
    const usable = (rows || []).filter((row) => finite(row.revenue) && number(row.revenue) > 0).slice(0, maxYears + 1);
    return usable.slice(0, -1).map((row, index) => {
      const prior = usable[index + 1];
      return number(prior?.revenue) > 0 ? number(row.revenue) / number(prior.revenue) - 1 : null;
    }).filter(finite);
  }

  function historicalAssumptions(rows, maxYears = 5) {
    const recent = (rows || []).filter((row) => finite(row.revenue) && Number(row.revenue) > 0).slice(0, maxYears);
    const latest = recent[0] || {};
    const oldest = recent.at(-1) || {};
    const elapsed = Math.max(1, number(latest.year) - number(oldest.year));
    const revenueGrowth = recent.length > 1 && number(oldest.revenue) > 0
      ? (number(latest.revenue) / number(oldest.revenue)) ** (1 / elapsed) - 1
      : 0.05;
    const componentMargin = (key) => average(recent.map((row) => finite(row[key]) ? number(row[key]) / number(row.revenue) : null)) ?? 0;
    const latestNwc = finite(latest.netWorkingCapital) ? number(latest.netWorkingCapital)
      : ["accountsReceivable", "inventory", "prepaidExpenses", "accountsPayable", "accruedExpenses"].some((key) => finite(latest[key]))
        ? number(latest.accountsReceivable) + number(latest.inventory) + number(latest.prepaidExpenses)
          - number(latest.accountsPayable) - number(latest.accruedExpenses)
        : 0;
    return {
      latestRevenue: number(latest.revenue),
      revenueGrowth: clamp(revenueGrowth, -0.20, 0.30),
      ebitMargin: average(recent.map((row) => finite(row.ebit) ? number(row.ebit) / number(row.revenue) : null)) ?? 0.12,
      taxRate: clamp(average(recent.map((row) => row.effectiveTaxRate)) ?? 0.21, 0, 0.45),
      dnaMargin: average(recent.map((row) => finite(row.dna) ? number(row.dna) / number(row.revenue) : null)) ?? 0.03,
      capexMargin: average(recent.map((row) => finite(row.capex) ? number(row.capex) / number(row.revenue) : null)) ?? 0.04,
      accountsReceivableMargin: componentMargin("accountsReceivable"),
      inventoryMargin: componentMargin("inventory"),
      prepaidExpensesMargin: componentMargin("prepaidExpenses"),
      accountsPayableMargin: componentMargin("accountsPayable"),
      accruedExpensesMargin: componentMargin("accruedExpenses"),
      latestNwc
    };
  }

  function autoForecast(rows, years, caseName = "base") {
    return autoForecastWithDrivers(rows, years, caseName, {});
  }

  function autoForecastWithDrivers(rows, years, caseName = "base", drivers = {}) {
    const assumptions = historicalAssumptions(rows);
    const adjustment = caseName === "bear"
      ? { growth: -0.02, ebit: -0.02, capex: 0.01 }
      : caseName === "bull"
        ? { growth: 0.02, ebit: 0.02, capex: -0.005 }
        : { growth: 0, ebit: 0, capex: 0 };
    const latestYear = Math.max(...(rows || []).map((row) => number(row.year)).filter(Boolean), new Date().getFullYear() - 1);
    const growthRates = historicalGrowthRates(rows, 5);
    const latestGrowth = growthRates[0] ?? assumptions.revenueGrowth;
    const revenueMethod = drivers.revenueMethod || "cagr5";
    const startingGrowth = revenueMethod === "latest" ? latestGrowth
      : revenueMethod === "cagr3" ? (cagr(rows, 3) ?? assumptions.revenueGrowth)
        : revenueMethod === "average" ? (average(growthRates) ?? assumptions.revenueGrowth)
          : revenueMethod === "median" ? (median(growthRates) ?? assumptions.revenueGrowth)
            : (cagr(rows, 5) ?? assumptions.revenueGrowth);
    const marginRows = (rows || []).filter((row) => finite(row.ebit) && finite(row.revenue) && number(row.revenue) > 0);
    const margins = marginRows.map((row) => number(row.ebit) / number(row.revenue));
    const marginMethod = drivers.ebitMarginMethod || "average5";
    const startingMargin = marginMethod === "latest" ? (margins[0] ?? assumptions.ebitMargin)
      : marginMethod === "average3" ? (average(margins.slice(0, 3)) ?? assumptions.ebitMargin)
        : marginMethod === "median" ? (median(margins.slice(0, 5)) ?? assumptions.ebitMargin)
          : (average(margins.slice(0, 5)) ?? assumptions.ebitMargin);
    const driverOrHistory = (key) => finite(drivers[key]) ? number(drivers[key]) : assumptions[key];
    const dnaMargin = driverOrHistory("dnaMargin");
    const capexMargin = driverOrHistory("capexMargin");
    const accountsReceivableMargin = driverOrHistory("accountsReceivableMargin");
    const inventoryMargin = driverOrHistory("inventoryMargin");
    const prepaidExpensesMargin = driverOrHistory("prepaidExpensesMargin");
    const accountsPayableMargin = driverOrHistory("accountsPayableMargin");
    const accruedExpensesMargin = driverOrHistory("accruedExpensesMargin");
    let revenue = assumptions.latestRevenue;
    let priorNwc = assumptions.latestNwc;
    const forecastYears = clamp(number(years, 5), 1, 10);
    return Array.from({ length: clamp(number(years, 5), 1, 10) }, (_, index) => {
      const progress = forecastYears === 1 ? 1 : index / (forecastYears - 1);
      const targetGrowth = finite(drivers.terminalRevenueGrowth) ? number(drivers.terminalRevenueGrowth) : startingGrowth;
      const selectedGrowth = revenueMethod === "fade" ? startingGrowth + (targetGrowth - startingGrowth) * progress : startingGrowth;
      const growth = clamp(selectedGrowth + adjustment.growth, -0.50, 0.75);
      revenue *= 1 + growth;
      const targetMargin = finite(drivers.terminalEbitMargin) ? number(drivers.terminalEbitMargin) : startingMargin;
      const selectedMargin = marginMethod === "fade" ? startingMargin + (targetMargin - startingMargin) * progress : startingMargin;
      const accountsReceivable = revenue * accountsReceivableMargin;
      const inventory = revenue * inventoryMargin;
      const prepaidExpenses = revenue * prepaidExpensesMargin;
      const accountsPayable = revenue * accountsPayableMargin;
      const accruedExpenses = revenue * accruedExpensesMargin;
      const operatingCurrentAssets = accountsReceivable + inventory + prepaidExpenses;
      const operatingCurrentLiabilities = accountsPayable + accruedExpenses;
      const netWorkingCapital = operatingCurrentAssets - operatingCurrentLiabilities;
      const changeInNwc = netWorkingCapital - priorNwc;
      priorNwc = netWorkingCapital;
      return {
        year: latestYear + index + 1,
        revenue,
        revenueGrowth: growth,
        ebit: revenue * clamp(selectedMargin + adjustment.ebit, -0.50, 0.80),
        taxRate: assumptions.taxRate,
        dna: revenue * Math.max(0, dnaMargin),
        capex: revenue * Math.max(0, capexMargin + adjustment.capex),
        accountsReceivable,
        inventory,
        prepaidExpenses,
        operatingCurrentAssets,
        accountsPayable,
        accruedExpenses,
        operatingCurrentLiabilities,
        netWorkingCapital,
        changeInNwc,
        source: "Automatically derived",
        sources: {
          revenue: "Selected revenue-growth rule",
          revenueGrowth: "Selected revenue-growth rule",
          ebit: "Revenue × selected EBIT margin",
          dna: "Revenue × D&A / revenue",
          capex: "Revenue × CapEx / revenue",
          accountsReceivable: "Revenue × A/R / revenue",
          inventory: "Revenue × inventory / revenue",
          prepaidExpenses: "Revenue × prepaids / revenue",
          operatingCurrentAssets: "A/R + inventory + prepaids",
          accountsPayable: "Revenue × A/P / revenue",
          accruedExpenses: "Revenue × accrued expenses / revenue",
          operatingCurrentLiabilities: "A/P + accrued expenses",
          netWorkingCapital: "Operating current assets − liabilities",
          changeInNwc: "Current operating NWC − prior operating NWC"
        }
      };
    });
  }

  function backtestForecast(rows, drivers = {}) {
    const chronological = (rows || []).filter((row) => finite(row.revenue) && finite(row.ebit)).slice().sort((a, b) => number(a.year) - number(b.year));
    const results = [];
    for (let index = 3; index < chronological.length; index += 1) {
      const target = chronological[index];
      const history = chronological.slice(0, index).slice().sort((a, b) => number(b.year) - number(a.year));
      const predicted = autoForecastWithDrivers(history, 1, "base", drivers)[0];
      const revenueError = number(target.revenue) ? predicted.revenue / number(target.revenue) - 1 : null;
      const ebitError = number(target.ebit) ? predicted.ebit / number(target.ebit) - 1 : null;
      results.push({ year: target.year, predictedRevenue: predicted.revenue, actualRevenue: target.revenue, revenueError, predictedEbit: predicted.ebit, actualEbit: target.ebit, ebitError });
    }
    return {
      results,
      revenueMape: average(results.map((row) => finite(row.revenueError) ? Math.abs(row.revenueError) : null)),
      revenueBias: average(results.map((row) => row.revenueError)),
      ebitMape: average(results.map((row) => finite(row.ebitError) ? Math.abs(row.ebitError) : null)),
      ebitBias: average(results.map((row) => row.ebitError))
    };
  }

  function calculateFcffYear(input) {
    const revenue = number(input.revenue);
    const ebit = number(input.ebit);
    const taxRate = clamp(number(input.taxRate, 0.21), 0, 1);
    const taxesOnEbit = ebit * taxRate;
    const nopat = ebit - taxesOnEbit;
    const dna = number(input.dna);
    const capex = number(input.capex);
    const changeInNwc = number(input.changeInNwc);
    return {
      ...input,
      revenue,
      ebit,
      taxRate,
      taxesOnEbit,
      nopat,
      dna,
      capex,
      changeInNwc,
      ebitda: ebit + dna,
      fcff: nopat + dna - capex - changeInNwc
    };
  }

  function calculateWacc(input) {
    const riskFreeRate = number(input.riskFreeRate);
    const beta = number(input.beta, 1);
    const equityRiskPremium = number(input.equityRiskPremium);
    const additionalPremium = number(input.additionalPremium);
    const preTaxCostOfDebt = number(input.preTaxCostOfDebt);
    const taxRate = clamp(number(input.taxRate, 0.21), 0, 1);
    const equityValue = Math.max(0, number(input.equityValue));
    const debtValue = Math.max(0, number(input.debtValue));
    const totalCapital = equityValue + debtValue;
    const equityWeight = totalCapital > 0 ? equityValue / totalCapital : 1;
    const debtWeight = totalCapital > 0 ? debtValue / totalCapital : 0;
    const costOfEquity = riskFreeRate + beta * equityRiskPremium + additionalPremium;
    const afterTaxCostOfDebt = preTaxCostOfDebt * (1 - taxRate);
    const calculatedWacc = equityWeight * costOfEquity + debtWeight * afterTaxCostOfDebt;
    const wacc = input.mode === "manual" ? number(input.manualWacc, calculatedWacc) : calculatedWacc;
    return { costOfEquity, afterTaxCostOfDebt, equityWeight, debtWeight, calculatedWacc, wacc };
  }

  function terminalValue(finalYear, terminal, wacc) {
    if (!finalYear) return { value: null, error: "A forecast year is required." };
    if (terminal.method === "exit") {
      const basis = terminal.exitMetric === "ebit" ? finalYear.ebit
        : terminal.exitMetric === "fcff" ? finalYear.fcff
          : finalYear.ebit;
      return { value: number(basis) * number(terminal.exitMultiple), basis, method: "exit" };
    }
    const growth = number(terminal.growthRate);
    if (wacc <= growth) return { value: null, error: "WACC must be greater than the terminal growth rate." };
    return { value: finalYear.fcff * (1 + growth) / (wacc - growth), method: "perpetuity" };
  }

  function calculateCase(model, bridge, convention = "year-end") {
    const waccResult = calculateWacc(model.wacc || {});
    const wacc = waccResult.wacc;
    const years = (model.forecast || []).map(calculateFcffYear);
    let forecastPresentValue = 0;
    years.forEach((year, index) => {
      const exponent = convention === "mid-year" ? index + 0.5 : index + 1;
      year.discountFactor = 1 / ((1 + wacc) ** exponent);
      year.presentValue = year.fcff * year.discountFactor;
      forecastPresentValue += year.presentValue;
    });
    const terminal = terminalValue(years.at(-1), model.terminal || {}, wacc);
    const terminalExponent = convention === "mid-year" ? Math.max(0.5, years.length - 0.5) : years.length;
    const terminalPresentValue = finite(terminal.value) ? terminal.value / ((1 + wacc) ** terminalExponent) : null;
    const enterpriseValue = finite(terminalPresentValue) ? forecastPresentValue + terminalPresentValue : null;
    const equityValue = finite(enterpriseValue)
      ? enterpriseValue + number(bridge.cash) + number(bridge.nonOperatingAssets)
        - number(bridge.debt) - number(bridge.preferredStock) - number(bridge.minorityInterest)
      : null;
    const impliedSharePrice = finite(equityValue) && number(bridge.shares) > 0 ? equityValue / number(bridge.shares) : null;
    const upside = finite(impliedSharePrice) && number(bridge.currentPrice) > 0
      ? impliedSharePrice / number(bridge.currentPrice) - 1
      : null;
    const warnings = [];
    if (terminal.error) warnings.push(terminal.error);
    if (!finite(wacc) || wacc <= 0) warnings.push("WACC must be positive.");
    if (!number(bridge.shares)) warnings.push("Diluted shares are required for per-share value.");
    if (finite(enterpriseValue) && finite(terminalPresentValue) && enterpriseValue !== 0 && terminalPresentValue / enterpriseValue > 0.85) {
      warnings.push("Terminal value represents more than 85% of enterprise value.");
    }
    return {
      years,
      ...waccResult,
      terminalValue: terminal.value,
      terminalPresentValue,
      forecastPresentValue,
      enterpriseValue,
      equityValue,
      impliedSharePrice,
      upside,
      terminalShare: finite(enterpriseValue) && enterpriseValue !== 0 ? terminalPresentValue / enterpriseValue : null,
      warnings
    };
  }

  function sensitivity(model, bridge, convention = "year-end") {
    const baseWacc = calculateWacc(model.wacc || {}).wacc;
    const waccValues = [-0.02, -0.01, 0, 0.01, 0.02].map((change) => Math.max(0.001, baseWacc + change));
    const isExit = model.terminal?.method === "exit";
    const baseTerminal = isExit ? number(model.terminal.exitMultiple) : number(model.terminal.growthRate);
    const terminalValues = (isExit ? [-2, -1, 0, 1, 2] : [-0.01, -0.005, 0, 0.005, 0.01])
      .map((change) => Math.max(0, baseTerminal + change));
    const cells = terminalValues.map((terminalInput) => waccValues.map((waccInput) => {
      const copy = JSON.parse(JSON.stringify(model));
      copy.wacc.mode = "manual";
      copy.wacc.manualWacc = waccInput;
      if (isExit) copy.terminal.exitMultiple = terminalInput;
      else copy.terminal.growthRate = terminalInput;
      return calculateCase(copy, bridge, convention).impliedSharePrice;
    }));
    return { waccValues, terminalValues, cells, isExit };
  }

  return {
    average,
    median,
    cagr,
    historicalGrowthRates,
    historicalAssumptions,
    autoForecast,
    autoForecastWithDrivers,
    backtestForecast,
    calculateFcffYear,
    calculateWacc,
    terminalValue,
    calculateCase,
    sensitivity
  };
});
