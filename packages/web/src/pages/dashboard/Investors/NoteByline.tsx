import { formatDateTime } from "../Pipeline/deal-signals";

type NoteAuthorship = {
  notesCreatedAt: string | null;
  notesCreatedBy: string | null;
  notesUpdatedAt: string | null;
  notesUpdatedBy: string | null;
};

type NoteBylineProps = {
  contact: NoteAuthorship;
  /** User id → display name, built from the workspace member list. */
  authorNames: Map<string, string>;
};

/**
 * Who wrote the shared investor note and when it last changed. An unattributed
 * note reads as fact; knowing a teammate wrote it three months ago is what
 * makes it possible to judge. Shown wherever the note itself is.
 */
export function NoteByline({ contact, authorNames }: NoteBylineProps) {
  const created = contact.notesCreatedAt;
  const updated = contact.notesUpdatedAt;
  // Notes written before authorship was recorded have neither timestamp, and
  // saying nothing is better than inventing a byline.
  if (!created && !updated) return null;

  const author = contact.notesCreatedBy ? authorNames.get(contact.notesCreatedBy) : null;
  const editor = contact.notesUpdatedBy ? authorNames.get(contact.notesUpdatedBy) : null;
  // A later edit only earns its own clause when it actually changed something.
  const edited = updated && updated !== created;

  return (
    <p className="mt-3 text-[11px] text-muted-foreground">
      {created && (
        <>
          Added {author ? `by ${author} ` : ""}
          {formatDateTime(created)}
        </>
      )}
      {edited && (
        <>
          {created ? " · " : ""}
          Last edited {editor ? `by ${editor} ` : ""}
          {formatDateTime(updated)}
        </>
      )}
    </p>
  );
}
