import {
  PERMISSION_DEPENDENCIES,
  PERMISSION_KEYS,
  RESOURCE_META,
  ROLE_TEMPLATES,
  expandPermissionKeys,
} from "../../src/config/permissions";

describe("expandPermissionKeys", () => {
  it("adds the read grant a write grant is useless without", () => {
    expect(expandPermissionKeys(["pipeline:update"])).toEqual(["pipeline:read", "pipeline:update"]);
  });

  it("returns catalog order regardless of input order, so audit diffs stay stable", () => {
    expect(expandPermissionKeys(["chat:manage", "chat:create"])).toEqual([
      "chat:read",
      "chat:create",
      "chat:manage",
    ]);
  });

  it("de-duplicates a dependency the caller already asked for", () => {
    expect(expandPermissionKeys(["documents:read", "documents:share", "documents:read"])).toEqual([
      "documents:read",
      "documents:share",
    ]);
  });

  it("leaves a read-only selection untouched", () => {
    const readOnly = ["pipeline:read", "documents:read"];
    expect(expandPermissionKeys(readOnly)).toEqual(readOnly);
  });

  it("passes unknown keys through so a typo still fails validation rather than vanishing", () => {
    expect(expandPermissionKeys(["pipeline:read", "nonsense:read"])).toContain("nonsense:read");
  });

  it("is a fixed point on every seeded role template", () => {
    // A template that needed expanding would mean the seeded roles ship in the
    // broken shape this whole mechanism exists to prevent.
    for (const [name, keys] of Object.entries(ROLE_TEMPLATES)) {
      expect([name, expandPermissionKeys(keys)]).toEqual([name, expandPermissionKeys(expandPermissionKeys(keys))]);
      expect([name, [...keys].sort()]).toEqual([name, expandPermissionKeys(keys).sort()]);
    }
  });
});

describe("permission catalog integrity", () => {
  it("only declares dependencies between real permissions", () => {
    for (const [key, dependencies] of Object.entries(PERMISSION_DEPENDENCIES)) {
      expect(PERMISSION_KEYS).toContain(key);
      for (const dependency of dependencies) expect(PERMISSION_KEYS).toContain(dependency);
    }
  });

  it("labels every resource the catalog defines", () => {
    for (const key of PERMISSION_KEYS) {
      const resource = key.split(":")[0] as keyof typeof RESOURCE_META;
      expect(RESOURCE_META[resource]).toBeDefined();
    }
  });

  it("declares no dependency cycles", () => {
    for (const key of PERMISSION_KEYS) {
      // A cycle would make the closure loop; it terminates, and a key never
      // needs itself.
      const expanded = expandPermissionKeys([key]);
      expect(expanded.filter((k) => k === key)).toHaveLength(1);
    }
  });
});
