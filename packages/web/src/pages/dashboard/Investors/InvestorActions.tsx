import { Linkedin, Mail, MoreHorizontal } from "lucide-react";
import { Button } from "../../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import type { Investor } from "../../../lib/mock-data";

export function InvestorActions({ investor }: { investor: Investor }) {
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
        <DropdownMenuItem asChild>
          <a href={`mailto:${investor.email}`}>
            <Mail className="mr-2 h-4 w-4" /> Send email
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Linkedin className="mr-2 h-4 w-4" /> View LinkedIn
        </DropdownMenuItem>
        <DropdownMenuItem>Move to pipeline</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive">Archive</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
