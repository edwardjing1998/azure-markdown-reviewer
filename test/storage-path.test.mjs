import test from "node:test";
import assert from "node:assert/strict";

process.env.AZURE_STORAGE_ENDPOINT = "https://example.blob.core.windows.net";
process.env.AZURE_STORAGE_CONTAINER = "education";
process.env.AZURE_STORAGE_OUTPUT_PREFIX = "generated/";
const { assertAllowedBlob, normalizePrefix } = await import("../server/storage.mjs");

test("normalizes generated prefix", () => assert.equal(normalizePrefix("/generated"), "generated/"));
test("accepts generated assets", () => assert.equal(assertAllowedBlob("generated/book-01/chapter-01/page-01/content.md"), "generated/book-01/chapter-01/page-01/content.md"));
test("rejects traversal", () => assert.throws(() => assertAllowedBlob("generated/../secret")));
test("rejects other prefixes", () => assert.throws(() => assertAllowedBlob("temporary/file.png")));
