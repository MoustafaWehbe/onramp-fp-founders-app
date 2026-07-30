import { PageHeader } from "../../../components/layout/PageHeader";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";

export function AiInsights() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Insights"
        description="Review generated summaries, gap analyses, and investor intelligence."
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Recent Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-base font-medium">Market fit gap analysis for FinTech startup.</p>
            <p className="mt-2 text-sm text-muted-foreground">Completed 2 hours ago.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>AI Recommendations</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-4xl font-semibold">7</p>
            <p className="mt-2 text-sm text-muted-foreground">Strategic recommendations generated this week.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Chat Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-4xl font-semibold">3</p>
            <p className="mt-2 text-sm text-muted-foreground">Active AI-assisted conversations running.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
