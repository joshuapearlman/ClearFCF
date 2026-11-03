"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { isTrustedLocalRequest, readJsonBody } = require("../lib/http");

function request(body, headers = {}) {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(body)]);
  stream.headers = headers;
  return stream;
}

test("JSON body parsing rejects malformed and oversized input", async () => {
  assert.deepEqual(await readJsonBody(request('{"ok":true}'), 100), { ok: true });
  await assert.rejects(readJsonBody(request("{"), 100), (error) => error.statusCode === 400);
  await assert.rejects(readJsonBody(request("12345"), 4), (error) => error.statusCode === 413);
  await assert.rejects(readJsonBody(request("", { "content-length": "10" }), 4), (error) => error.statusCode === 413);
});

test("privileged local requests require a loopback host and matching browser origin", () => {
  assert.equal(isTrustedLocalRequest({ headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin" } }), true);
  assert.equal(isTrustedLocalRequest({ headers: { host: "localhost:3000" } }), true);
  assert.equal(isTrustedLocalRequest({ headers: { host: "127.0.0.1:3000", origin: "https://evil.example", "sec-fetch-site": "cross-site" } }), false);
  assert.equal(isTrustedLocalRequest({ headers: { host: "clearfcf.example", origin: "http://clearfcf.example" } }), false);
});
