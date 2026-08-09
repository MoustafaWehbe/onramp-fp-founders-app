import { useAuth } from "../../hooks/useAuth";
import { useWorkspace } from "../../hooks/useWorkspace";
import { PageHeader } from "../../components/layout/PageHeader";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";

export function Settings() {
  const { user } = useAuth();
  const { activeStartup } = useWorkspace();

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Manage your account settings." />

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your account information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Name</span>
            <span>{user ? `${user.firstName} ${user.lastName}`.trim() : "Account"}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Email</span>
            <span>{user?.email}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Workspace</span>
            <span>{activeStartup?.name ?? "—"}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Role</span>
            <span className="capitalize">{activeStartup?.member.role ?? "—"}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
