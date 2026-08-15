import {
  Briefcase,
  History,
  Linkedin,
  Mail,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { Button } from "../../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { usePermissions } from "../../../hooks/usePermissions";
import type { InvestorRow } from "./investor-types";

type InvestorActionsProps = {
  investor: InvestorRow;
  onMoveToPipeline?: (investor: InvestorRow) => void;
  onEdit?: (investor: InvestorRow) => void;
  onDelete?: (investor: InvestorRow) => void;
  onViewHistory?: (investor: InvestorRow) => void;
  onEmail?: (investor: InvestorRow) => void;
  /** Whether the founder's Google account is connected sending needs it. */
  googleConnected?: boolean;
  moving?: boolean;
};

export function InvestorActions({
  investor,
  onMoveToPipeline,
  onEdit,
  onDelete,
  onViewHistory,
  onEmail,
  googleConnected = false,
  moving = false,
}: InvestorActionsProps) {
  const { can } = usePermissions();
  const alreadyInPipeline = Boolean(investor.pipelineId);
  const canAddToPipeline = can("pipeline", "create");
  const canEdit = can("pipeline", "update");
  const canDelete = can("pipeline", "delete");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={`Actions for ${investor.name}`}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuItem onSelect={() => onViewHistory?.(investor)}>
          <History className="mr-2 h-4 w-4" /> View history
        </DropdownMenuItem>
        {onEmail && (
          <DropdownMenuItem
            disabled={!investor.email || !googleConnected}
            onSelect={() => onEmail(investor)}
          >
            <Mail className="mr-2 h-4 w-4" /> Send email
          </DropdownMenuItem>
        )}
        {investor.linkedinUrl && (
          <DropdownMenuItem asChild>
            <a href={investor.linkedinUrl} target="_blank" rel="noreferrer">
              <Linkedin className="mr-2 h-4 w-4" /> View LinkedIn
            </a>
          </DropdownMenuItem>
        )}

        {canEdit && (
          <DropdownMenuItem onSelect={() => onEdit?.(investor)}>
            <Pencil className="mr-2 h-4 w-4" /> Edit details
          </DropdownMenuItem>
        )}

        {canAddToPipeline && (
          <DropdownMenuItem
            disabled={alreadyInPipeline || moving || !onMoveToPipeline}
            onSelect={() => onMoveToPipeline?.(investor)}
          >
            <Briefcase className="mr-2 h-4 w-4" />
            {alreadyInPipeline ? "Already in pipeline" : moving ? "Adding…" : "Move to pipeline"}
          </DropdownMenuItem>
        )}

        {canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onSelect={() => onDelete?.(investor)}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Delete investor
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
