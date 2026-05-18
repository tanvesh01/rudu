# Context Map

## Contexts

- [Review Chat](./src/features/review-chat/CONTEXT.md) - AI-assisted pull request review using Review Sessions and Review Workspaces.
- [Issue Dashboard](./src/features/issues/CONTEXT.md) - provider-neutral issue tracking across GitHub and Linear.

## Relationships

- **Issue Dashboard -> Review Chat**: A **Linked Pull Request** can open the pull request workspace where **Review Chat** runs.
- **Review Chat -> Issue Dashboard**: A **Pull Request Attachment** may reference pull requests that are linked from **Issues**.
- **Issue Dashboard -> Review Chat**: An **Issue** can be referenced in **Review Chat** through an **Issue Attachment**.
