import { Fragment } from "react";
import { splitMessageBody } from "../../lib/mentions";
import { MentionChip } from "./MentionChip";

export function MessageBody({ body }: { body: string }) {
  const segments = splitMessageBody(body);

  return (
    <p className="whitespace-pre-wrap wrap-break-word text-sm text-foreground/90">
      {segments.map((segment, index) =>
        segment.kind === "text" ? (
          <Fragment key={index}>{segment.text}</Fragment>
        ) : (
          <MentionChip key={index} type={segment.type} label={segment.label} />
        ),
      )}
    </p>
  );
}
