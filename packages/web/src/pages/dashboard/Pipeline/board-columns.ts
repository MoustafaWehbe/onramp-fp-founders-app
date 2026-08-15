import { arrayMove } from "@dnd-kit/sortable";
import { STAGES, type PipelineStageId } from "../../../lib/mock-data";
import type { PipelineEntry } from "../../../lib/pipeline-api";

export type BoardColumns = Record<PipelineStageId, string[]>;

const COLUMN_DROP_PREFIX = "column:";

/** The droppable id for a column's empty space, distinct from any card id. */
export function columnDropId(stage: PipelineStageId): string {
  return `${COLUMN_DROP_PREFIX}${stage}`;
}

function asColumnDropId(id: string): PipelineStageId | undefined {
  return id.startsWith(COLUMN_DROP_PREFIX)
    ? (id.slice(COLUMN_DROP_PREFIX.length) as PipelineStageId)
    : undefined;
}

/** Groups deal ids by stage, preserving the order they're given in (the API sends sortOrder-ascending). */
export function buildColumns(entries: PipelineEntry[]): BoardColumns {
  const columns = Object.fromEntries(STAGES.map((stage) => [stage.id, [] as string[]])) as BoardColumns;
  for (const entry of entries) {
    const bucket = columns[entry.stage];
    if (bucket) bucket.push(entry.id);
    else columns.sourced.push(entry.id);
  }
  return columns;
}

export function columnOf(columns: BoardColumns, dealId: string): PipelineStageId | undefined {
  return (Object.keys(columns) as PipelineStageId[]).find((stage) => columns[stage].includes(dealId));
}

/**
 * Live-reorders `columns` as a drag passes over `overId` a card, or a
 * column's droppable id when hovering its empty space. Returns the same
 * `columns` reference when nothing actually needs to move.
 */
export function moveWithinColumns(
  columns: BoardColumns,
  activeId: string,
  overId: string,
): BoardColumns {
  if (activeId === overId) return columns;

  const fromStage = columnOf(columns, activeId);
  const toStage = columnOf(columns, overId) ?? asColumnDropId(overId);
  if (!fromStage || !toStage) return columns;

  if (fromStage === toStage) {
    const items = columns[fromStage];
    const oldIndex = items.indexOf(activeId);
    const newIndex = items.indexOf(overId);
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return columns;
    return { ...columns, [fromStage]: arrayMove(items, oldIndex, newIndex) };
  }

  const fromItems = columns[fromStage].filter((id) => id !== activeId);
  const toItems = columns[toStage].filter((id) => id !== activeId);
  const overIndex = toItems.indexOf(overId);
  toItems.splice(overIndex === -1 ? toItems.length : overIndex, 0, activeId);
  return { ...columns, [fromStage]: fromItems, [toStage]: toItems };
}

/** Gap used when a card lands at either end of a column, with nothing to average against. */
const EDGE_GAP = 1000;

/**
 * The sortOrder that places `dealId` where it currently sits in `columns` —
 * the midpoint of its neighbors, so a card can be dropped exactly between
 * two others without renumbering the rest of the column.
 */
export function computeDropOrder(
  columns: BoardColumns,
  dealId: string,
  sortOrderOf: (id: string) => number | undefined,
): number {
  const stage = columnOf(columns, dealId);
  if (!stage) return EDGE_GAP;

  const items = columns[stage];
  const index = items.indexOf(dealId);
  const prevOrder = index > 0 ? sortOrderOf(items[index - 1]) : undefined;
  const nextOrder = index < items.length - 1 ? sortOrderOf(items[index + 1]) : undefined;

  if (prevOrder !== undefined && nextOrder !== undefined) return (prevOrder + nextOrder) / 2;
  if (prevOrder !== undefined) return prevOrder + EDGE_GAP;
  if (nextOrder !== undefined) return nextOrder - EDGE_GAP;
  return EDGE_GAP;
}
