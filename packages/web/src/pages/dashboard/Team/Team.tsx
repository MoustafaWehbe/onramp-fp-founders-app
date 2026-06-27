import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";

export function Team() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Team</h1>
        <p className="text-muted-foreground">Manage teammates, roles, and collaborator access across startups.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Team Members</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold">14</p>
            <p className="mt-2 text-sm text-muted-foreground">Active users collaborating across all startups.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pending Invites</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold">6</p>
            <p className="mt-2 text-sm text-muted-foreground">Invites waiting for acceptance.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Roles & Permissions</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-base font-medium">Admin, Member, Reviewer</p>
            <p className="mt-2 text-sm text-muted-foreground">Controls roles for access to startups and documents.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
