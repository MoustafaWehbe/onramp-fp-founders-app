import { Link } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";

export function Pipeline() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Pipeline</h1>
        <p className="text-muted-foreground">Monitor your deals, upcoming follow-ups, and investor progress.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Total Opportunities</CardTitle>
            <CardDescription>Deals currently in your pipeline.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold">28</p>
            <p className="mt-2 text-sm text-muted-foreground">Active opportunities across all startups.</p>
          </CardContent>
          <CardFooter>
            <Link to="/pipeline" className="text-sm text-primary">View details</Link>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Key Follow-ups</CardTitle>
            <CardDescription>Never miss the next investor meeting.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold">5</p>
            <p className="mt-2 text-sm text-muted-foreground">Scheduled follow-ups in the next 7 days.</p>
          </CardContent>
          <CardFooter>
            <Link to="/pipeline" className="text-sm text-primary">Open pipeline</Link>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
