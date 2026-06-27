import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";

export function Documents() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Documents</h1>
        <p className="text-muted-foreground">Store and manage fundraising collateral, legal files, and investor decks.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Total Documents</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold">86</p>
            <p className="mt-2 text-sm text-muted-foreground">Files uploaded for startups and investor reviews.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Latest Upload</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-base font-medium">Investor Deck - Series A</p>
            <p className="mt-2 text-sm text-muted-foreground">Uploaded 1 day ago.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Review Requests</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold">4</p>
            <p className="mt-2 text-sm text-muted-foreground">Documents waiting for reviewer feedback.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
