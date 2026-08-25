import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS,
  PERMISSION_CATALOG,
  PERMISSION_DEPENDENCIES,
  ROLE_PERMISSIONS,
  expandPermissionKeys,
  permissionLabel,
  permissionsRequiring,
  roleCan,
} from "../../lib/permissions";
import { PAGE_ACCESS } from "../../lib/page-access";
// Imported straight from the API package: this copy exists only to gate UI, and
// the moment it disagrees with the server the app starts offering buttons that
// 403 (or hiding ones that would have worked).
import {
  PERMISSIONS,
  PERMISSION_DEPENDENCIES as SERVER_DEPENDENCIES,
  RESOURCE_META,
  ROLE_TEMPLATES,
  expandPermissionKeys as serverExpand,
} from "../../../../api/src/config/permissions";

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
    expect(roleCan("viewer", "financial", "read")).toBe(false);
  });

  it("lets a collaborator invite teammates, but not change roles, remove members, or manage roles", () => {
    expect(roleCan("collaborator", "team", "create")).toBe(true);
    for (const action of ["update", "delete", "manage"] as const) {
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

describe("client catalog mirrors the server", () => {
  it("lists exactly the permissions the server defines, in the same order", () => {
    expect([...ALL_PERMISSIONS]).toEqual(PERMISSIONS.map((p) => `${p.resource}:${p.action}`));
  });

  it("labels every resource the same way the server does", () => {
    for (const group of PERMISSION_CATALOG) {
      expect([group.resource, group.label]).toEqual([group.resource, RESOURCE_META[group.resource].label]);
    }
  });

  it("declares the same dependency graph the server enforces", () => {
    // The server closes over its own copy on every write, so a drift here
    // would show the founder one set of checkboxes and save another.
    expect(PERMISSION_DEPENDENCIES).toEqual(SERVER_DEPENDENCIES);
  });

  it("expands a selection identically to the server", () => {
    for (const key of ALL_PERMISSIONS) {
      expect([key, expandPermissionKeys([key])]).toEqual([key, serverExpand([key])]);
    }
  });
});

describe("permission dependencies", () => {
  it("pulls in the read grant a write grant is useless without", () => {
    expect(expandPermissionKeys(["pipeline:update"])).toEqual(["pipeline:read", "pipeline:update"]);
  });

  it("reports which grants a read is currently propping up", () => {
    expect(permissionsRequiring("financial:read")).toEqual([
      "financial:create",
      "financial:update",
      "financial:delete",
    ]);
    expect(permissionsRequiring("financial:delete")).toEqual([]);
  });

  it("names a permission the way the role editor labels it", () => {
    expect(permissionLabel("financial:read")).toBe("Rounds & commitments: View");
    expect(permissionLabel("pipeline:create")).toBe("Investors & pipeline: Add");
  });
});

describe("page access map", () => {
  it("only requires permissions that exist", () => {
    for (const requirement of Object.values(PAGE_ACCESS)) {
      expect(ALL_PERMISSIONS).toContain(`${requirement.resource}:${requirement.action}`);
    }
  });

  it("keeps the pipeline board off the financial grant", () => {
    // The board is round-scoped, but "which rounds exist" is not the same
    // secret as "how much we are raising" — revoking Rounds & commitments
    // used to leave the whole board unreachable.
    expect(PAGE_ACCESS["/pipeline"]).toEqual({ resource: "pipeline", action: "read" });
    expect(PAGE_ACCESS["/investors"]).toEqual({ resource: "pipeline", action: "read" });
  });

  it("lets every seeded role reach the pages its template implies", () => {
    const reachable = (role: keyof typeof ROLE_TEMPLATES) =>
      Object.entries(PAGE_ACCESS)
        .filter(([, req]) => (ROLE_TEMPLATES[role] as readonly string[]).includes(`${req.resource}:${req.action}`))
        .map(([path]) => path);

    expect(reachable("viewer")).toContain("/pipeline");
    expect(reachable("viewer")).not.toContain("/fundraising");
    expect(reachable("collaborator")).toContain("/fundraising");
    expect(reachable("owner").sort()).toEqual(Object.keys(PAGE_ACCESS).sort());
  });
});
