"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const screenHandler = require("../api/screen");

test("screen performance values are rounded and safely bounded", () => {
  assert.equal(screenHandler.boundedInteger("3.6", 1, 1, 8), 4);
  assert.equal(screenHandler.boundedInteger(-50, 250, 0, 5000), 0);
  assert.equal(screenHandler.boundedInteger(100, 8, 1, 25), 25);
  assert.equal(screenHandler.boundedInteger("not-a-number", 250, 0, 5000), 250);
});
