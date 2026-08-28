import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_RECEIPT_BYTES,
  ALLOWED_RECEIPT_TYPES,
  RECEIPT_ACCEPT_ATTR,
  RECEIPT_BUCKET,
  ReceiptError,
  formatBytes,
  validateReceipt,
  buildReceiptPath,
  isStoragePath,
  ownerOfPath,
} from "./receipts.js";

const file = (over = {}) => ({
  type: "image/jpeg",
  size: 1024,
  name: "receipt.jpg",
  ...over,
});

describe("validateReceipt - accepted types", () => {
  for (const [type, ext] of Object.entries(ALLOWED_RECEIPT_TYPES)) {
    test(`accepts ${type}`, () => {
      const r = validateReceipt(file({ type }));
      assert.equal(r.extension, ext);
      assert.equal(r.contentType, type);
    });
  }

  test("is case-insensitive about the content type", () => {
    assert.equal(validateReceipt(file({ type: "IMAGE/JPEG" })).extension, "jpg");
  });

  test("the accept attribute lists every allowed type", () => {
    for (const type of Object.keys(ALLOWED_RECEIPT_TYPES)) {
      assert.ok(RECEIPT_ACCEPT_ATTR.includes(type), `${type} missing from accept`);
    }
  });
});

describe("validateReceipt - rejections", () => {
  test("rejects an unlisted type rather than guessing", () => {
    // Accept-list, not deny-list: anything unknown is refused.
    for (const type of ["text/html", "application/zip", "image/svg+xml", ""]) {
      assert.throws(
        () => validateReceipt(file({ type })),
        ReceiptError,
        `${type} should be rejected`
      );
    }
  });

  test("an SVG is refused - it can carry script", () => {
    assert.throws(() => validateReceipt(file({ type: "image/svg+xml" })), ReceiptError);
  });

  test("rejects a file over the cap, naming both sizes", () => {
    assert.throws(
      () => validateReceipt(file({ size: MAX_RECEIPT_BYTES + 1 })),
      (e) => e instanceof ReceiptError && /under 5\.0 MB.*yours is/.test(e.message)
    );
  });

  test("accepts a file exactly at the cap", () => {
    assert.doesNotThrow(() => validateReceipt(file({ size: MAX_RECEIPT_BYTES })));
  });

  test("rejects an empty or sizeless file", () => {
    assert.throws(() => validateReceipt(file({ size: 0 })), ReceiptError);
    assert.throws(() => validateReceipt(file({ size: -1 })), ReceiptError);
    assert.throws(() => validateReceipt(file({ size: NaN })), ReceiptError);
  });

  test("rejects missing input", () => {
    assert.throws(() => validateReceipt(null), ReceiptError);
    assert.throws(() => validateReceipt(undefined), ReceiptError);
    assert.throws(() => validateReceipt("a-string"), ReceiptError);
  });

  test("the cap matches the existing scanner's 5MB limit", () => {
    assert.equal(MAX_RECEIPT_BYTES, 5 * 1024 * 1024);
  });
});

describe("buildReceiptPath", () => {
  test("namespaces by scope and owner", () => {
    const path = buildReceiptPath({
      ownerId: "user-1", scope: "shared", extension: "jpg", token: "abc",
    });
    assert.equal(path, "shared/user-1/abc.jpg");
  });

  test("personal scope", () => {
    assert.equal(
      buildReceiptPath({ ownerId: "u", scope: "personal", extension: "pdf", token: "t" }),
      "personal/u/t.pdf"
    );
  });

  test("one user cannot land in another's namespace", () => {
    const mine = buildReceiptPath({ ownerId: "a", scope: "shared", extension: "jpg", token: "x" });
    const theirs = buildReceiptPath({ ownerId: "b", scope: "shared", extension: "jpg", token: "x" });
    assert.notEqual(mine, theirs);
    assert.equal(ownerOfPath(mine), "a");
    assert.equal(ownerOfPath(theirs), "b");
  });

  test("paths are unguessable - a real token is random", () => {
    const a = buildReceiptPath({ ownerId: "u", scope: "shared", extension: "jpg" });
    const b = buildReceiptPath({ ownerId: "u", scope: "shared", extension: "jpg" });
    assert.notEqual(a, b, "two uploads must not collide");
  });

  test("rejects bad input", () => {
    assert.throws(() => buildReceiptPath({ scope: "shared", extension: "jpg" }), ReceiptError);
    assert.throws(
      () => buildReceiptPath({ ownerId: "u", scope: "elsewhere", extension: "jpg" }),
      ReceiptError
    );
    assert.throws(() => buildReceiptPath({ ownerId: "u", scope: "shared" }), ReceiptError);
  });
});

describe("isStoragePath / ownerOfPath", () => {
  test("recognises our own paths", () => {
    assert.ok(isStoragePath("shared/u/x.jpg"));
    assert.ok(isStoragePath("personal/u/x.pdf"));
  });

  test("an external URL is not a storage path", () => {
    // Older rows could hold a full URL; reads must not treat it as an object key.
    assert.ok(!isStoragePath("https://example.com/r.jpg"));
    assert.ok(!isStoragePath("http://example.com/r.jpg"));
  });

  test("junk is not a storage path", () => {
    for (const v of [null, undefined, "", 42, {}, "random/thing.jpg"]) {
      assert.ok(!isStoragePath(v), `${JSON.stringify(v)} should not match`);
    }
  });

  test("ownerOfPath extracts the owner, or null", () => {
    assert.equal(ownerOfPath("shared/user-9/x.jpg"), "user-9");
    assert.equal(ownerOfPath("https://example.com/x.jpg"), null);
    assert.equal(ownerOfPath("shared/incomplete"), null);
    assert.equal(ownerOfPath(null), null);
  });
});

describe("formatBytes", () => {
  test("scales sensibly", () => {
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(2048), "2 KB");
    assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
  });

  test("handles junk without throwing", () => {
    assert.equal(formatBytes(null), "0 B");
    assert.equal(formatBytes("nonsense"), "0 B");
  });
});

describe("bucket", () => {
  test("is a single named bucket", () => {
    assert.equal(RECEIPT_BUCKET, "receipts");
  });
});
