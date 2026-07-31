import { Badge } from "../../../components/ui/badge";
import { getStage, type PipelineStageId } from "../../../lib/mock-data";
import { cn } from "../../../lib/utils";

export function StageBadge({ stageId }: { stageId: PipelineStageId }) {
  const stage = getStage(stageId);

  return (
    <Badge variant="outline" className={cn("border-transparent font-medium", stage.badgeClass)}>
      {stage.label}
    </Badge>
  );
}
