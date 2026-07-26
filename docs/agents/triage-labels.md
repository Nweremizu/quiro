# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## Setup notes

Canonical vocabulary was chosen — every role's label string equals its name, so no translation is needed.

`wontfix` already existed as one of GitHub's stock default labels. The other four were created during setup (2026-07-26). GitHub's stock `question` label was deliberately **not** reused for `needs-info`: it's ambiguous between "a user is asking something" and "we are blocked waiting on the reporter."

The rest of the stock defaults (`bug`, `documentation`, `duplicate`, `enhancement`, `good first issue`, `help wanted`, `invalid`, `question`) are untouched and orthogonal to triage state — use them freely for categorisation alongside a triage label.

## `ready-for-agent` is the load-bearing one

It marks an issue as specified well enough that an agent can pick it up **cold, with no human context**. `/implement` looks for it. `/to-tickets` output should generally land already at this bar; incoming reports processed by `/triage` usually should not, until someone has done the specification work.
