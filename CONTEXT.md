# Rudu Issue Dashboard

This context names the issue-tracking concepts used by the local PR and issue dashboard.

## Language

**Issue**:
A provider-neutral unit of work from GitHub or Linear.
_Avoid_: Work item, ticket, task

**Issue Provider**:
An external system that supplies issues to the dashboard.
_Avoid_: Source, integration

**Issue Bucket**:
A mutually exclusive dashboard grouping for viewer-relevant issues.
_Avoid_: Section, category

**Assigned Issue**:
An issue assigned to the viewer.
_Avoid_: Owned issue

**Subscribed Issue**:
An issue the viewer is following or has been pulled into.
_Avoid_: Mentioned issue

**Created Issue**:
An issue created by the viewer.
_Avoid_: Authored issue

**In Progress Issue**:
An issue with active work owned by the viewer.
_Avoid_: Started issue

**Linear API Key**:
A personal Linear credential used by the local app to read Linear issues.
_Avoid_: Linear OAuth token

**Linear Integration**:
The connection between Rudu and Linear that lets Linear supply issues to the dashboard.
_Avoid_: Linear setup, Linear auth

## Relationships

- An **Issue Provider** supplies zero or more **Issues**.
- An **Issue** belongs to exactly one **Issue Provider**.
- An **Issue** appears in at most one **Issue Bucket**.
- **Issue Bucket** priority is **In Progress Issue**, then **Assigned Issue**, then **Subscribed Issue**, then **Created Issue**.
- The **Linear Integration** uses a **Linear API Key**.
- An **In Progress Issue** is scoped to the viewer, not the whole workspace.
- An **Assigned Issue** is a role-specific view of an **Issue**.
- A **Subscribed Issue** is a role-specific view of an **Issue**.
- A **Created Issue** is a role-specific view of an **Issue**.

## Example dialogue

> **Dev:** "Should Linear tickets be shown as a separate kind of work item?"
> **Domain expert:** "No - in this app they are **Issues** from the Linear **Issue Provider**."

> **Dev:** "Should we call the bucket Mentioned or Subscribed?"
> **Domain expert:** "Use **Subscribed Issue** because it maps across GitHub and Linear."

> **Dev:** "Should In Progress include all started Linear issues?"
> **Domain expert:** "No - an **In Progress Issue** is only work owned by the viewer."

> **Dev:** "Can an issue appear in Assigned and Created?"
> **Domain expert:** "No - each **Issue** appears in its highest-priority **Issue Bucket** only."

## Flagged ambiguities

- "work item" was considered as the shared GitHub/Linear concept - resolved: use **Issue** instead.
- "mentioned" was considered as a dashboard bucket - resolved: use **Subscribed Issue** instead.
- "authored" was considered as a dashboard bucket - resolved: use **Created Issue** instead.
- "in progress" was considered as all started Linear issues - resolved: use only viewer-owned **In Progress Issues**.
- "bucket" was considered as a loose UI section - resolved: use **Issue Bucket** with exclusive membership.
