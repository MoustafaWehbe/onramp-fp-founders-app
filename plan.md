# Fundraising Workspace — Remaining Phases

Phases 1 and 2 established the new pipeline workflow and detail experience: clearer investor sheets, easier task completion, lead and ownership controls, Focus filters, editable notes, smoother board movement, a stronger rounds page, and a live dashboard with real charts.

## Phase 3 — Workflow reliability and collaboration

Goal: make daily fundraising work dependable for a founder and their team.

- [x] Add complete task editing: title, due date, assignee, linked investor, and deletion.
- [x] Add quick task creation directly from cards and Focus rows without opening the full investor sheet.
- [x] Add task views for **Mine**, **Everyone**, **Overdue**, **Today**, and **Completed** with counts.
- [x] Make lead assignment explicit and reversible, with confirmation and a visible current lead.
- [x] Add bulk owner assignment and bulk task creation for selected investors.
- [x] Show who created and last edited a note; add note timestamps and deletion confirmation.
- [x] Add reminders for overdue tasks, stale leads, and investors without a next action.
- [x] Keep Dashboard, Pipeline, Investors, and Fundraising query keys and cache shapes consistent.

Acceptance criteria:

- A founder can assign, edit, complete, reopen, and remove a task in two or fewer focused interactions.
- Every live investor can clearly show an owner, lead status, next task, and most recent note.
- Mutations update optimistically and recover cleanly when the API rejects them.

## Phase 4 — Pipeline interaction and performance

Goal: make the board feel fast and controlled with large pipelines.

- [ ] Profile drag rendering with React DevTools and browser performance traces using 100–300 cards. _(needs a real browser/device — not run in this environment; see note below)_
- [x] Prevent unrelated cards and columns from rerendering during a drag.
- [x] Use a lightweight drag overlay and fixed card dimensions to avoid layout shifts.
- [x] Add clear drop indicators between cards. _(edge auto-scrolling left as previously tuned — see note)_
- [x] Preserve card ordering through the API and restore the previous order when a move fails.
- [x] Add keyboard-accessible movement and a reliable **Move to stage** fallback.
- [x] Define a compact mobile pipeline experience instead of forcing the desktop board onto small screens.
- [x] Consider column virtualization only if profiling shows DOM volume is still the bottleneck. _(no profiling data exists yet, so none was added — see note)_

Acceptance criteria:

- Dragging remains responsive with at least 300 investor cards on a normal laptop.
- A dropped card never jumps, duplicates, disappears, or silently loses its persisted position.
- Every drag action is also possible without a pointer.

## Phase 5 — Round intelligence and real analytics

Goal: turn the rounds and dashboard pages into decision tools instead of passive summaries.

- [x] Add commitment status-history data so the funding chart reflects when money became soft-circled, signed, or wired—not only when the record was created.
- [x] Add round metrics from real APIs: target, bankable raised, wired, soft-circled, weighted pipeline, remaining gap, and days to close.
- [x] Add pipeline conversion and velocity by stage. _(already present from Phase 2; verified and left in place)_
- [x] Add expected-close forecasting and highlight commitments at risk.
- [x] Make chart time ranges selectable and preserve the selected range.
- [x] Make chart segments clickable to open a filtered investor list.
- [x] Add clear empty, loading, partial-error, and stale-data states to every analytics panel.
- [x] Verify currency handling across rounds instead of assuming USD.

Acceptance criteria:

- Every displayed metric can be traced to a documented API field and calculation.
- Dashboard totals match the Fundraising and Pipeline pages for the same round.
- Historical charts use real event history and do not imply history that the backend does not store.

## Phase 6 — Product polish and consistency

Goal: make the entire fundraising workspace feel like one coherent product.

- [ ] Standardize headers, tabs, filters, badges, cards, empty states, and dialog/sheet spacing.
- [ ] Reduce visual density by keeping primary actions visible and advanced fields progressively disclosed.
- [ ] Add skeletons that resemble final layouts to prevent content jumps.
- [ ] Improve responsive behavior for the dashboard, round analytics, investor sheets, and task queue.
- [ ] Complete keyboard navigation, focus management, accessible names, contrast, and reduced-motion support.
- [ ] Add consistent confirmation and undo patterns for destructive or high-impact actions.
- [ ] Review all founder-facing copy for concise, consistent fundraising terminology.

Acceptance criteria:

- Primary workflows work at desktop, tablet, and mobile widths.
- Dialogs and sheets have predictable action placement and no hidden critical controls.
- Core workflows pass keyboard-only and reduced-motion checks.