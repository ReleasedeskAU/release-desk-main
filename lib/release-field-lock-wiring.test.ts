/**
 * Wiring verification for Release field locks.
 *
 * Confirms every user-facing Release write path either calls the engine, or is
 * reported here as an intentional gap (do not silently “fix” gaps in this file).
 *
 * Run: npm run test:lifecycle
 * (or: npx tsx --test lib/release-field-lock-wiring.test.ts)
 *
 * Integration cases that need a DB use scope `field_lock_wiring_test_scope`.
 * Set FIELD_LOCK_WIRING_SKIP_DB=1 to skip DB-backed cases.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import "@/lib/load-db-env-for-tests";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  loadReleaseFieldLockConfig,
  saveReleaseFieldLockConfig,
} from "@/lib/release-field-lock-config-db";
import {
  getFieldLockStateFromRows,
  validateReleaseFieldUpdate,
} from "@/lib/release-field-lock-engine";
import { createReleaseRow } from "@/lib/org-compat";

const ROOT = join(__dirname, "..");
const WIRING_SCOPE = "field_lock_wiring_test_scope";
const skipDb = process.env.FIELD_LOCK_WIRING_SKIP_DB === "1";

/** Read a repo-relative source file for wiring assertions. */
function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/**
 * Assert `needle` appears before `before` in source (first occurrence of each).
 * @throws AssertionError when order is wrong or either string is missing.
 */
function assertAppearsBefore(source: string, needle: string, before: string, label: string) {
  const iNeedle = source.indexOf(needle);
  const iBefore = source.indexOf(before);
  assert.ok(iNeedle >= 0, `${label}: missing ${needle}`);
  assert.ok(iBefore >= 0, `${label}: missing ${before}`);
  assert.ok(
    iNeedle < iBefore,
    `${label}: expected ${needle} before ${before}`
  );
}

describe("field-lock write-path inventory (source wiring)", () => {
  it("POST /api/releases calls validateReleaseFieldUpdate before createReleaseRow", () => {
    const src = readSrc("app/api/releases/route.ts");
    // Match call sites (imports also mention these names).
    assertAppearsBefore(
      src,
      "await validateReleaseFieldUpdate(",
      "await createReleaseRow(",
      "POST /api/releases"
    );
    assert.match(src, /FIELD_LOCK_DENIED/);
  });

  it("PATCH /api/releases/[id] calls validateReleaseFieldUpdate before prisma.release.update", () => {
    const src = readSrc("app/api/releases/[id]/route.ts");
    assertAppearsBefore(
      src,
      "await validateReleaseFieldUpdate(",
      "await prisma.release.update(",
      "PATCH /api/releases/[id]"
    );
    assert.match(src, /FIELD_LOCK_DENIED/);
    assert.match(src, /revert_to_pending_cab/);
    assert.match(src, /VR-21/);
  });

  it("PATCH /api/releases/[id] lets the field-lock catalog override coarse edit-mode denials", () => {
    const src = readSrc("app/api/releases/[id]/route.ts");
    assert.match(src, /catalogEntryForBodyKey/);
    assert.match(src, /isReleaseFullyLocked/);
    assert.match(src, /editPolicyDenied\.filter/);
  });

  it("Edit Release disables locked fields from the matrix up front", () => {
    const src = readSrc("components/releases/ReleaseFormModal.tsx");
    assert.match(src, /isReleaseBodyKeyLocked/);
    assert.match(src, /fieldLocked\("applicationIds"\)/);
    assert.match(src, /fieldLocked\("releaseType"\)/);
    assert.match(src, /fieldLocked\("goLiveDate"\)/);
    assert.match(src, /fieldLocked\("deployDate"\)/);
    assert.match(src, /fieldLocked\("deploymentWindow"\)/);
    assert.match(src, /fieldLocked\("dressRehearsal"\)/);
    assert.match(src, /Duration \(Days\)/);
    assert.match(src, /\/api\/release-field-lock-config/);
  });

  it("GET /api/releases/[id] attaches sheet computed fields", () => {
    const src = readSrc("app/api/releases/[id]/route.ts");
    assert.match(src, /loadReleaseSheetComputed/);
  });

  it("PUT /api/release-field-lock-config routes through saveReleaseFieldLockConfig", () => {
    const src = readSrc("app/api/release-field-lock-config/route.ts");
    assert.match(src, /saveReleaseFieldLockConfig/);
    assert.match(src, /status:\s*400/);
  });

  it("documents unwired Release mutators (gaps — not silently fixed here)", () => {
    const events = readSrc("app/api/releases/[id]/events/route.ts");
    assert.match(events, /prisma\.release\.update/);
    assert.equal(
      events.includes("validateReleaseFieldUpdate"),
      false,
      "events route still skips field-lock engine (decision field) — report only"
    );

    const risk = readSrc("lib/risk-scoring/calc.ts");
    assert.match(risk, /prisma\.release\.update/);
    assert.equal(
      risk.includes("validateReleaseFieldUpdate"),
      false,
      "risk-scoring system writer still skips field-lock engine — report only"
    );
  });
});

describe("config API validation (PUT layer)", () => {
  it(
    "rejects setting an isConfigurable=false field to editable",
    { skip: skipDb },
    async () => {
      await loadReleaseFieldLockConfig(WIRING_SCOPE);
      await assert.rejects(
        () =>
          saveReleaseFieldLockConfig(WIRING_SCOPE, [
            {
              fieldKey: "releaseCode",
              statusRules: { draft: "editable" },
            },
          ]),
        /not configurable/i
      );

      // Mirror PUT route mapping: non-configurable → 400
      let putStatus = 0;
      try {
        await saveReleaseFieldLockConfig(WIRING_SCOPE, [
          {
            fieldKey: "readinessPercent",
            statusRules: { draft: "editable" },
          },
        ]);
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        const clientError =
          /not configurable|Unknown|Invalid|Unknown status/i.test(message);
        putStatus = clientError ? 400 : 503;
      }
      assert.equal(putStatus, 400);
    }
  );
});

describe("engine gate used by write paths (locked / editable / VR-21)", () => {
  it(
    "rejects a locked field and allows an editable field for live config",
    { skip: skipDb },
    async () => {
      const loaded = await loadReleaseFieldLockConfig(WIRING_SCOPE);
      const statuses = loaded.lifecycleConfig.statuses.filter((s) => s.enabled);
      assert.ok(statuses.length > 0, "need at least one enabled status");

      // Release ID is always locked in the matrix (isConfigurable=false).
      const lockedStatus = statuses[0]!;
      const denied = await validateReleaseFieldUpdate(
        WIRING_SCOPE,
        lockedStatus.label,
        ["releaseCode"]
      );
      assert.equal(denied.allowed, false);
      assert.ok(denied.rejected.some((r) => r.field === "releaseCode"));

      // Find any (field, status) the live matrix marks editable.
      let editableBodyKey: string | null = null;
      let editableStatusLabel: string | null = null;
      for (const status of statuses) {
        for (const row of loaded.rows) {
          if (
            getFieldLockStateFromRows(loaded.rows, row.fieldKey, status.key) ===
            "editable"
          ) {
            editableBodyKey = row.fieldKey;
            editableStatusLabel = status.label;
            break;
          }
        }
        if (editableBodyKey) break;
      }
      assert.ok(editableBodyKey && editableStatusLabel, "expected an editable cell");

      const allowed = await validateReleaseFieldUpdate(
        WIRING_SCOPE,
        editableStatusLabel,
        [editableBodyKey]
      );
      assert.equal(allowed.allowed, true);
    }
  );

  it(
    "VR-21: Size/Priority at CAB Approved is editable_with_side_effect and DB status reverts",
    { skip: skipDb },
    async () => {
      const loaded = await loadReleaseFieldLockConfig(WIRING_SCOPE);
      const cab = loaded.lifecycleConfig.statuses.find(
        (s) => s.key === "cab_approved"
      );
      const pending = loaded.lifecycleConfig.statuses.find(
        (s) => s.key === "pending_cab"
      );
      assert.ok(cab && pending, "need cab_approved and pending_cab in live lifecycle");

      for (const field of ["releaseSize", "priority"] as const) {
        const state = getFieldLockStateFromRows(loaded.rows, field, cab.key);
        assert.equal(
          state,
          "editable_with_side_effect",
          `${field} at CAB Approved should be editable_with_side_effect`
        );
      }

      const sizeCheck = await validateReleaseFieldUpdate(
        WIRING_SCOPE,
        cab.label,
        ["releaseSize"]
      );
      assert.equal(sizeCheck.allowed, true);
      assert.ok(
        sizeCheck.sideEffects.some((s) => s.effect === "revert_to_pending_cab")
      );

      const dept = await prisma.department.findFirst({ select: { id: true } });
      assert.ok(dept, "need a department row for wiring release");

      const code = `FLW-${Date.now().toString(36).toUpperCase()}`;
      const release = await createReleaseRow({
        releaseCode: code,
        name: "Field-lock wiring VR-21",
        programProject: "N/A",
        owner: "Wiring Test",
        status: cab.label,
        releaseDate: new Date("2026-12-01"),
        priority: "P2 - High",
        impact: "Medium",
        departmentId: dept.id,
        notes: null,
        dependencies: null,
        releaseSize: "M",
        cabDate: null,
        startDate: null,
        testEnvRequired: null,
        uatEnvRequired: null,
        conflictFlag: false,
        conflictId: null,
        readinessPercent: null,
        blockers: null,
        vendorMaintenance: null,
        changeFreeze: null,
        regulatory: null,
        approvalStatus: null,
        rollbackPlan: null,
        goLiveChecklistPercent: null,
        deploymentWindow: null,
        releaseOwnerId: null,
        lifecycleConfigVersionId: null,
      });

      try {
        // Exercise the same sequence PATCH uses: allow write, then VR-21 revert.
        const before = await prisma.release.findUniqueOrThrow({
          where: { id: release.id },
        });
        assert.equal(before.status, cab.label);

        await prisma.release.update({
          where: { id: release.id },
          data: { releaseSize: "L" },
        });

        const { enforceReleaseStatusChange } = await import(
          "@/lib/release-lifecycle-status-patch"
        );
        const afterFields = await prisma.release.findUniqueOrThrow({
          where: { id: release.id },
        });
        const enforcement = await enforceReleaseStatusChange({
          clerkUserId: WIRING_SCOPE,
          release: afterFields,
          requestedStatus: pending.label,
          overrideReason: "VR-21: size/priority change after CAB approval",
          previousStatusHint: before.status,
        });

        if (!enforcement.ok) {
          // Report gap: VR-21 side effect may be blocked by lifecycle gates — do not hide.
          assert.fail(
            `VR-21 revert blocked by lifecycle enforcement: ${enforcement.body.code} — ${JSON.stringify(enforcement.body)}`
          );
        }

        await prisma.release.update({
          where: { id: release.id },
          data: { status: enforcement.canonicalStatus },
        });

        const final = await prisma.release.findUniqueOrThrow({
          where: { id: release.id },
        });
        assert.equal(final.releaseSize, "L");
        assert.equal(final.status, enforcement.canonicalStatus);
        assert.equal(
          final.status,
          pending.label,
          "release status must land on Pending CAB after VR-21"
        );
      } finally {
        await prisma.release
          .delete({ where: { id: release.id } })
          .catch(() => undefined);
      }
    }
  );
});

describe("HTTP handlers with session mock", () => {
  async function installAuthMock(): Promise<boolean> {
    const { mock } = await import("node:test");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockAny = mock as any;
    if (typeof mockAny.module !== "function") return false;
    mockAny.module("@/lib/auth/api", {
      namedExports: {
        requireSession: async () => ({
          user: { id: WIRING_SCOPE, role: "admin" },
          error: null,
        }),
        requireRole: async () => ({
          user: { id: WIRING_SCOPE, role: "admin" },
          error: null,
        }),
      },
    });
    return true;
  }

  it(
    "PUT /api/release-field-lock-config returns 400 for non-configurable field",
    { skip: skipDb },
    async () => {
      if (!(await installAuthMock())) return;

      const { PUT } = await import("@/app/api/release-field-lock-config/route");
      const req = new NextRequest("http://local/api/release-field-lock-config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rows: [
            {
              fieldKey: "releaseCode",
              statusRules: { draft: "editable" },
            },
          ],
        }),
      });
      const res = await PUT(req);
      assert.equal(res.status, 400);
      const body = (await res.json()) as { error?: string };
      assert.match(String(body.error ?? ""), /not configurable/i);
    }
  );

  it(
    "PATCH /api/releases/[id] rejects locked releaseCode (400 FIELD_LOCK_DENIED)",
    { skip: skipDb },
    async () => {
      if (!(await installAuthMock())) return;

      await loadReleaseFieldLockConfig(WIRING_SCOPE);
      const dept = await prisma.department.findFirst({ select: { id: true } });
      assert.ok(dept);
      const code = `FLW-L-${Date.now().toString(36).toUpperCase()}`;
      const release = await createReleaseRow({
        releaseCode: code,
        name: "Field-lock wiring locked PATCH",
        programProject: "N/A",
        owner: "Wiring Test",
        status: "Draft",
        releaseDate: new Date("2026-12-01"),
        priority: "P3 - Medium",
        impact: "Medium",
        departmentId: dept.id,
      });

      try {
        const { PATCH } = await import("@/app/api/releases/[id]/route");
        const before = await prisma.release.findUniqueOrThrow({
          where: { id: release.id },
        });
        const req = new NextRequest(
          `http://local/api/releases/${release.id}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ releaseCode: `${code}-X` }),
          }
        );
        const res = await PATCH(req, {
          params: Promise.resolve({ id: release.id }),
        });
        assert.equal(res.status, 400);
        const body = (await res.json()) as { code?: string };
        assert.equal(body.code, "FIELD_LOCK_DENIED");
        const after = await prisma.release.findUniqueOrThrow({
          where: { id: release.id },
        });
        assert.equal(after.releaseCode, before.releaseCode);
      } finally {
        await prisma.release
          .delete({ where: { id: release.id } })
          .catch(() => undefined);
      }
    }
  );

  it(
    "PATCH illegal status with echoed Release ID returns ILLEGAL_TRANSITION not FIELD_LOCK",
    { skip: skipDb },
    async () => {
      if (!(await installAuthMock())) return;

      const loaded = await loadReleaseFieldLockConfig(WIRING_SCOPE);
      const pending = loaded.lifecycleConfig.statuses.find(
        (s) => s.key === "pending_cab"
      );
      const rolled = loaded.lifecycleConfig.statuses.find(
        (s) => s.key === "rolled_back"
      );
      assert.ok(pending && rolled);

      const dept = await prisma.department.findFirst({ select: { id: true } });
      assert.ok(dept);
      const code = `FLW-ST-${Date.now().toString(36).toUpperCase()}`;
      const release = await createReleaseRow({
        releaseCode: code,
        name: "Field-lock wiring status echo",
        programProject: "N/A",
        owner: "Wiring Test",
        status: pending.label,
        releaseDate: new Date("2026-12-01"),
        priority: "P3 - Medium",
        impact: "Medium",
        departmentId: dept.id,
      });

      try {
        const { PATCH } = await import("@/app/api/releases/[id]/route");
        const req = new NextRequest(
          `http://local/api/releases/${release.id}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              releaseCode: code,
              name: release.name,
              status: rolled.label,
            }),
          }
        );
        const res = await PATCH(req, {
          params: Promise.resolve({ id: release.id }),
        });
        assert.equal(res.status, 422);
        const body = (await res.json()) as { code?: string; error?: string };
        assert.equal(body.code, "ILLEGAL_TRANSITION");
        const after = await prisma.release.findUniqueOrThrow({
          where: { id: release.id },
        });
        assert.equal(after.status, pending.label);
        assert.equal(after.releaseCode, code);
      } finally {
        await prisma.release
          .delete({ where: { id: release.id } })
          .catch(() => undefined);
      }
    }
  );

  it(
    "PATCH Size on CAB Approved reverts status to Pending CAB (VR-21)",
    { skip: skipDb },
    async () => {
      if (!(await installAuthMock())) return;

      const loaded = await loadReleaseFieldLockConfig(WIRING_SCOPE);
      const cab = loaded.lifecycleConfig.statuses.find(
        (s) => s.key === "cab_approved"
      );
      const pending = loaded.lifecycleConfig.statuses.find(
        (s) => s.key === "pending_cab"
      );
      assert.ok(cab && pending);

      const dept = await prisma.department.findFirst({ select: { id: true } });
      assert.ok(dept);
      const code = `FLW-V-${Date.now().toString(36).toUpperCase()}`;
      const release = await createReleaseRow({
        releaseCode: code,
        name: "Field-lock wiring VR-21 PATCH",
        programProject: "N/A",
        owner: "Wiring Test",
        status: cab.label,
        releaseDate: new Date("2026-12-01"),
        priority: "P2 - High",
        impact: "Medium",
        departmentId: dept.id,
        releaseSize: "M",
      });

      try {
        const { PATCH } = await import("@/app/api/releases/[id]/route");
        const req = new NextRequest(
          `http://local/api/releases/${release.id}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ releaseSize: "L" }),
          }
        );
        const res = await PATCH(req, {
          params: Promise.resolve({ id: release.id }),
        });
        assert.equal(res.status, 200);
        const after = await prisma.release.findUniqueOrThrow({
          where: { id: release.id },
        });
        assert.equal(after.releaseSize, "L");
        assert.equal(after.status, pending.label);
      } finally {
        await prisma.release
          .delete({ where: { id: release.id } })
          .catch(() => undefined);
      }
    }
  );

  it(
    "PATCH /api/releases/[id] allows editable notes on Draft",
    { skip: skipDb },
    async () => {
      if (!(await installAuthMock())) return;

      const loaded = await loadReleaseFieldLockConfig(WIRING_SCOPE);
      const draft = loaded.lifecycleConfig.statuses.find((s) => s.key === "draft");
      assert.ok(draft);
      assert.equal(
        getFieldLockStateFromRows(loaded.rows, "notes", draft.key),
        "editable"
      );

      const dept = await prisma.department.findFirst({ select: { id: true } });
      assert.ok(dept);
      const code = `FLW-E-${Date.now().toString(36).toUpperCase()}`;
      const release = await createReleaseRow({
        releaseCode: code,
        name: "Field-lock wiring editable PATCH",
        programProject: "N/A",
        owner: "Wiring Test",
        status: draft.label,
        releaseDate: new Date("2026-12-01"),
        priority: "P3 - Medium",
        impact: "Medium",
        departmentId: dept.id,
        notes: "before",
      });

      try {
        const { PATCH } = await import("@/app/api/releases/[id]/route");
        const req = new NextRequest(
          `http://local/api/releases/${release.id}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ notes: "after-wiring" }),
          }
        );
        const res = await PATCH(req, {
          params: Promise.resolve({ id: release.id }),
        });
        assert.equal(res.status, 200);
        const after = await prisma.release.findUniqueOrThrow({
          where: { id: release.id },
        });
        assert.equal(after.notes, "after-wiring");
      } finally {
        await prisma.release
          .delete({ where: { id: release.id } })
          .catch(() => undefined);
      }
    }
  );
});

after(async () => {
  if (!skipDb) {
    await Promise.race([
      prisma.$disconnect().catch(() => undefined),
      new Promise((r) => setTimeout(r, 5_000)),
    ]);
  }
});
