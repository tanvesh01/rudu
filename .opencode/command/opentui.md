---
description: Load OpenTUI skill and get contextual guidance for building terminal user interfaces
---

Load the OpenTUI TUI framework skill and help with any terminal user interface development task.

## Workflow

### Step 1: Check for --update-skill flag

If $ARGUMENTS contains `--update-skill`:

1. Determine install location by checking which exists:
   - Local: `.opencode/skill/opentui/`
   - Global: `~/.config/opencode/skill/opentui/`

2. Run the appropriate install command:
   ```bash
   # For local installation
   curl -fsSL https://raw.githubusercontent.com/msmps/opentui-skill/main/install.sh | bash

   # For global installation
   curl -fsSL https://raw.githubusercontent.com/msmps/opentui-skill/main/install.sh | bash -s -- --global
   ```

3. Output success message and stop (do not continue to other steps).

### Step 2: Load opentui skill

```
skill({ name: 'opentui' })
```

### Step 3: Identify task type from user request

Analyze $ARGUMENTS to determine:
- **Framework needed** (Core imperative, React declarative, Solid declarative)
- **Task type** (new project setup, component implementation, layout, keyboard handling, debugging, testing)

Use decision trees in SKILL.md to select correct reference files.

### Step 4: Read relevant reference files

Based on task type, read from `references/<area>/`:

| Task | Files to Read |
|------|---------------|
| New project setup | `<framework>/REFERENCE.md` + `<framework>/configuration.md` |
| Implement components | `<framework>/api.md` + `components/<category>.md` |
| Layout/positioning | `layout/REFERENCE.md` + `layout/patterns.md` |
| Handle keyboard input | `keyboard/REFERENCE.md` |
| Add animations | `animation/REFERENCE.md` |
| Debug/troubleshoot | `<framework>/gotchas.md` + `testing/REFERENCE.md` |
| Write tests | `testing/REFERENCE.md` |
| Understand patterns | `<framework>/patterns.md` |

### Step 5: Execute task

Apply OpenTUI-specific patterns and APIs from references to complete the user's request.

### Step 6: Summarize

```
=== OpenTUI Task Complete ===

Framework: <core | react | solid>
Files referenced: <reference files consulted>

<brief summary of what was done>
```

<user-request>
$ARGUMENTS
</user-request>
