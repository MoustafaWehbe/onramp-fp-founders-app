import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";

export function Investors() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Investors</h1>
        <p className="text-muted-foreground">Manage your investor relationships and outreach pipeline.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Active Investors</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold">41</p>
            <p className="mt-2 text-sm text-muted-foreground">Investors currently linked to your startups.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>New Contacts</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold">12</p>
            <p className="mt-2 text-sm text-muted-foreground">Investors added this month.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Warm Leads</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold">9</p>
            <p className="mt-2 text-sm text-muted-foreground">Highly engaged investors for follow-up.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
