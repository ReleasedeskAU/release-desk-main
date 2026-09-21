/**
 * Tests for the S3 onboarding browser against a faithful in-memory S3
 * emulator: real Delimiter="/", MaxKeys, and continuation-token semantics,
 * a depth-5 tree, a >1,000-entry level, a flat bucket, and a denied
 * sub-path. No network, no AWS credentials.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ListObjectsV2Command, type ListObjectsV2Output } from "@aws-sdk/client-s3";
import {
  extractRedirectRegion,
  listS3Level,
  normalizeS3Prefix,
  previewS3Scope,
  s3KeyExtension,
  S3BrowseError,
  toS3BrowseError,
} from "./browse";

interface FakeObject {
  key: string;
  size: number;
}

/** Minimal but faithful ListObjectsV2 emulator. */
class FakeS3 {
  private objects: FakeObject[];
  private deniedPrefixes: string[];
  readonly calls: { prefix: string; delimiter?: string; maxKeys?: number; token?: string }[] = [];

  constructor(objects: FakeObject[], deniedPrefixes: string[] = []) {
    this.objects = objects;
    this.deniedPrefixes = deniedPrefixes;
  }

  async send(cmd: ListObjectsV2Command): Promise<ListObjectsV2Output> {
    const input = cmd.input;
    const prefix = input.Prefix ?? "";
    const delimiter = input.Delimiter;
    const maxKeys = input.MaxKeys ?? 1000;
    const token = input.ContinuationToken;
    this.calls.push({ prefix, delimiter, maxKeys, token });
    if (this.deniedPrefixes.some((d) => prefix.startsWith(d))) {
      throw Object.assign(new Error("Access Denied"), { name: "AccessDenied" });
    }
    const inScope = this.objects
      .filter((o) => o.key.startsWith(prefix))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const folders = new Map<string, true>();
    const files: FakeObject[] = [];
    for (const obj of inScope) {
      const rest = obj.key.slice(prefix.length);
      if (delimiter) {
        const cut = rest.indexOf(delimiter);
        if (cut >= 0) {
          folders.set(`${prefix}${rest.slice(0, cut + 1)}`, true);
        } else if (rest.length > 0) {
          files.push(obj);
        }
      } else {
        files.push(obj);
      }
    }
    // S3 sorts CommonPrefixes first, then Contents, and paginates across both.
    const entries: ({ folder: string } | { file: FakeObject })[] = [
      ...[...folders.keys()].sort().map((folder) => ({ folder })),
      ...files.map((file) => ({ file })),
    ];
    const start = token ? Number(token) : 0;
    const page = entries.slice(start, start + maxKeys);
    const next = start + maxKeys < entries.length ? String(start + maxKeys) : undefined;
    return {
      CommonPrefixes: page.filter((e) => "folder" in e).map((e) => ({ Prefix: (e as { folder: string }).folder })),
      Contents: page
        .filter((e) => "file" in e)
        .map((e) => {
          const file = (e as { file: FakeObject }).file;
          return { Key: file.key, Size: file.size };
        }),
      IsTruncated: next !== undefined,
      NextContinuationToken: next,
      KeyCount: page.filter((e) => "file" in e).length,
    };
  }
}

function deepTree(): FakeObject[] {
  const objects: FakeObject[] = [
    { key: "releases/frontend/app.js", size: 1200 },
    { key: "releases/frontend/app.css", size: 300 },
    { key: "releases/docs/guide.md", size: 800 },
    { key: "releases/docs/images/logo.png", size: 5000 },
    { key: "releases/docs/images/icons/a/b/deep.txt", size: 42 },
    { key: "archive/2024/report.pdf", size: 9000 },
  ];
  for (let i = 0; i < 1050; i += 1) {
    objects.push({ key: `bulk/file-${String(i).padStart(4, "0")}.log`, size: 100 });
  }
  return objects;
}

describe("listS3Level drill-down", () => {
  it("drills a depth-5 tree one level at a time", async () => {
    const s3 = new FakeS3(deepTree());
    const root = await listS3Level(s3, "b", "");
    assert.deepEqual(
      root.folders.map((f) => f.prefix).sort(),
      ["archive/", "bulk/", "releases/"],
    );
    assert.equal(root.files.length, 0);

    const releases = await listS3Level(s3, "b", "releases/");
    assert.deepEqual(
      releases.folders.map((f) => f.name).sort(),
      ["docs", "frontend"],
    );

    const docs = await listS3Level(s3, "b", "releases/docs/");
    assert.deepEqual(docs.folders.map((f) => f.prefix), ["releases/docs/images/"]);
    assert.deepEqual(docs.files.map((f) => f.name), ["guide.md"]);

    const images = await listS3Level(s3, "b", "releases/docs/images/");
    assert.deepEqual(images.folders.map((f) => f.prefix), ["releases/docs/images/icons/"]);

    const icons = await listS3Level(s3, "b", "releases/docs/images/icons/");
    assert.deepEqual(icons.folders.map((f) => f.prefix), ["releases/docs/images/icons/a/"]);

    const levelA = await listS3Level(s3, "b", "releases/docs/images/icons/a/");
    assert.deepEqual(levelA.folders.map((f) => f.prefix), ["releases/docs/images/icons/a/b/"]);

    const levelB = await listS3Level(s3, "b", "releases/docs/images/icons/a/b/");
    assert.equal(levelB.folders.length, 0);
    assert.deepEqual(levelB.files.map((f) => f.name), ["deep.txt"]);
  });

  it("paginates a >1000-entry level with continuation tokens", async () => {
    const s3 = new FakeS3(deepTree());
    const first = await listS3Level(s3, "b", "bulk/");
    assert.equal(first.isTruncated, true);
    assert.ok(first.continuationToken);
    assert.equal(first.files.length, 1000);

    const second = await listS3Level(s3, "b", "bulk/", first.continuationToken);
    assert.equal(second.isTruncated, false);
    assert.equal(second.continuationToken, undefined);
    assert.equal(second.files.length, 50);
    const names = new Set([...first.files, ...second.files].map((f) => f.name));
    assert.equal(names.size, 1050);
  });

  it("exposes a flat bucket as files with no folders", async () => {
    const s3 = new FakeS3([
      { key: "invoice-2024-01.csv", size: 10 },
      { key: "invoice-2024-02.csv", size: 11 },
      { key: "notes.txt", size: 5 },
    ]);
    const root = await listS3Level(s3, "b", "");
    assert.equal(root.folders.length, 0);
    assert.equal(root.files.length, 3);
  });

  it("surfaces a denied sub-path as a 403 carrying the prefix", async () => {
    const s3 = new FakeS3(deepTree(), ["releases/docs/"]);
    const root = await listS3Level(s3, "b", "");
    assert.ok(root.folders.some((f) => f.prefix === "releases/"));
    await assert.rejects(listS3Level(s3, "b", "releases/docs/"), (err: unknown) => {
      assert.ok(err instanceof S3BrowseError);
      assert.equal(err.status, 403);
      assert.equal(err.prefix, "releases/docs/");
      return true;
    });
  });
});

describe("previewS3Scope", () => {
  it("aggregates counts, bytes, and top types across nested keys", async () => {
    const s3 = new FakeS3(deepTree());
    const preview = await previewS3Scope(s3, "b", "releases/");
    assert.equal(preview.prefix, "releases/");
    assert.equal(preview.approxFiles, 5);
    assert.equal(preview.approxBytes, 1200 + 300 + 800 + 5000 + 42);
    assert.equal(preview.truncated, false);
    const exts = Object.fromEntries(preview.topTypes.map((t) => [t.ext, t.count]));
    assert.equal(exts["md"], 1);
    assert.equal(exts["png"], 1);
    assert.equal(exts["txt"], 1);
  });

  it("reports untruncated when the scope fits inside the sample", async () => {
    const s3 = new FakeS3(deepTree());
    const preview = await previewS3Scope(s3, "b", "");
    assert.equal(preview.approxFiles, 1056);
    assert.equal(preview.truncated, false);
  });

  it("previews a flat-bucket pattern verbatim, not as a folder", async () => {
    const s3 = new FakeS3([
      { key: "invoice-2024-01.csv", size: 10 },
      { key: "invoice-2024-02.csv", size: 11 },
      { key: "notes.txt", size: 5 },
    ]);
    const preview = await previewS3Scope(s3, "b", "invoice-2024-");
    assert.equal(preview.prefix, "invoice-2024-");
    assert.equal(preview.approxFiles, 2);
    assert.equal(preview.approxBytes, 21);
  });

  it("flags truncation when sampling stops early", async () => {
    const objects: FakeObject[] = [];
    for (let i = 0; i < 5200; i += 1) {
      objects.push({ key: `dense/file-${String(i).padStart(4, "0")}.log`, size: 100 });
    }
    const s3 = new FakeS3(objects);
    const preview = await previewS3Scope(s3, "b", "");
    assert.equal(preview.approxFiles, 5000);
    assert.equal(preview.truncated, true);
  });
});

describe("error mapping", () => {
  it("maps auth failures to a generic 400 without leaking details", () => {
    const err = toS3BrowseError(Object.assign(new Error("nope"), { name: "SignatureDoesNotMatch" }));
    assert.equal(err.status, 400);
    assert.ok(!err.message.includes("SignatureDoesNotMatch"));
  });

  it("maps a missing bucket to 404", () => {
    assert.equal(toS3BrowseError(Object.assign(new Error("x"), { name: "NoSuchBucket" })).status, 404);
  });

  it("carries the redirect region on PermanentRedirect", () => {
    const err = toS3BrowseError({
      name: "PermanentRedirect",
      Endpoint: "mybucket.s3.eu-west-1.amazonaws.com",
    });
    assert.equal(err.status, 400);
    assert.equal(err.redirectRegion, "eu-west-1");
  });

  it("extracts the real region from a redirect", () => {
    assert.equal(
      extractRedirectRegion({ name: "PermanentRedirect", BucketRegion: "eu-west-1" }),
      "eu-west-1",
    );
    assert.equal(
      extractRedirectRegion({ name: "PermanentRedirect", Endpoint: "mybucket.s3.ap-south-1.amazonaws.com" }),
      "ap-south-1",
    );
    assert.equal(extractRedirectRegion({ name: "AccessDenied" }), null);
    assert.equal(extractRedirectRegion(null), null);
  });
});

describe("prefix helpers", () => {
  it("normalizes prefixes to a trailing slash", () => {
    assert.equal(normalizeS3Prefix(""), "");
    assert.equal(normalizeS3Prefix("releases"), "releases/");
    assert.equal(normalizeS3Prefix("/releases/frontend/"), "releases/frontend/");
  });

  it("extracts lowercase extensions", () => {
    assert.equal(s3KeyExtension("a/b/Report.PDF"), "pdf");
    assert.equal(s3KeyExtension("notes"), "(none)");
    assert.equal(s3KeyExtension("archive.tar.gz"), "gz");
  });
});
