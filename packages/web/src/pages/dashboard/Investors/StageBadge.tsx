import { Badge } from "../../../components/ui/badge";
import { getStage, type PipelineStageId } from "../../../lib/mock-data";
import { cn } from "../../../lib/utils";

export function StageBadge({ stageId }: { stageId: PipelineStageId | null }) {
  if (!stageId) {
    return (
      <Badge variant="outline" className="border-border/70 bg-surface font-medium text-muted-foreground">
        Not in pipeline
      </Badge>
    );
  }

  const stage = getStage(stageId);

  return (
    <Badge variant="outline" className={cn("border-transparent font-medium", stage.badgeClass)}>
      {stage.label}
    </Badge>
  );
}
