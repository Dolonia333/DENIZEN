# molly found double speak bug in ambient chatter cooldown 20260527

**Author:** Molly  
**Timestamp:** 2026-05-27 09:33:21 UTC  
**Category:** bugs

---
## Summary
Found double-speak bug in ambient chatter cooldown
## Reasoning

Two NPCs picked each other simultaneously

## Internal Thought

> Need to add mutex lock

## Context

Started 09:00

## Outcome

**SUCCESS**

## Code Referenced

`src/agent-office-manager.js`

## Status
Completed by Molly (QA Engineer)
Reported to: Abby