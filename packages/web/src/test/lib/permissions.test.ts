import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS, roleCan } from "../../lib/permissions";
// Imported straight from the API package: this copy exists only to gate UI, and
// the moment it disagrees with the server the app starts offering buttons that
// 403 (or hiding ones that would have worked).
import { PERMISSIONS, ROLE_TEMPLATES } from "../../../../api/src/config/permissions";

describe("client permission matrix", () => {
  it("covers exactly the roles the server defines", () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual(Object.keys(ROLE_TEMPLATES).sort());
  });

  it("grants owner every permission the server knows about", () => {
    const server = PERMISSIONS.map((p) => `${p.resource}:${p.action}`).sort();
    expect([...ROLE_PERMISSIONS.owner].sort()).toEqual(server);
  });

  it.each(["collaborator", "viewer"] as const)("matches the server's %s template", (role) => {
    expect([...ROLE_PERMISSIONS[role]].sort()).toEqual([...ROLE_TEMPLATES[role]].sort());
  });
});

describe("roleCan", () => {
  it("lets collaborators work the pipeline but not delete from it", () => {
    expect(roleCan("collaborator", "pipeline", "create")).toBe(true);
    expect(roleCan("collaborator", "pipeline", "update")).toBe(true);
    expect(roleCan("collaborator", "pipeline", "delete")).toBe(false);
  });

  it("gives viewers read access and nothing more", () => {
    expect(roleCan("viewer", "pipeline", "read")).toBe(true);
    expect(roleCan("viewer", "pipeline", "create")).toBe(false);
    expect(roleCan("viewer", "team", "create")).toBe(false);
  });

  it("keeps team management to owners", () => {
    for (const action of ["create", "update", "delete"] as const) {
      expect(roleCan("owner", "team", action)).toBe(true);
      expect(roleCan("collaborator", "team", action)).toBe(false);
      expect(roleCan("viewer", "team", action)).toBe(false);
    }
  });

  it("grants nothing for an unknown or absent role", () => {
    // A server-side custom role would land here; failing closed is the only
    // safe default.
    expect(roleCan("finance-lead", "pipeline", "read")).toBe(false);
    expect(roleCan(null, "pipeline", "read")).toBe(false);
  });
});
