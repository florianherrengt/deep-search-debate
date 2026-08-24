Read the ticket with `kanban-md show $ARGUMENTS`.
Update the existing ticket with the repository context needed to implement it.

Your job is only to investigate and document. Do not implement, design a solution, make architectural/product decisions, or resolve ambiguities.

Find and document:

what the ticket is asking for and why;
current relevant behaviour and implementation;
relevant files, symbols, components, APIs, schemas, configuration, tests, and dependencies;
existing patterns and conventions that an implementation agent will need to know;
known requirements, constraints, edge cases, and acceptance criteria;
ambiguities, contradictions, and missing information.

Update the existing ticket directly. Preserve its original intent and scope.

Base statements on repository evidence. Include file paths and relevant symbols wherever useful so another agent can jump directly to the code instead of rediscovering it.

Anything you cannot establish should be recorded as an open question. Do not guess.

The goal is that a stronger implementation agent can read the updated ticket and begin work without repeating this repository investigation.
