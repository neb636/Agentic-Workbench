# Configuration files

DimSum keeps shared configuration in plain JSON files, so a team can check them in and review them like code.

## Three layers

Each configuration file can exist in three places:

| Layer | Path | Use it for |
| --- | --- | --- |
| Yours | `~/.dimsum/<name>.json` | Your own settings, in every workspace. |
| Workspace | `<workspace>/.dimsum/<name>.json` | Settings for everyone in the repository. Check this file in. |
| Local | `<workspace>/.dimsum/<name>.local.json` | Your own settings for one workspace. Never commit this file. |

The first time DimSum writes a local file, it makes sure `.dimsum/.gitignore` keeps `*.local.json` files out of Git. If you already have that `.gitignore`, the rule is added to it.

Workspace files must be ordinary files inside the workspace. If `.dimsum`, or anything inside it, is a symbolic link, DimSum won't read from it or write to it.

There are two configuration files: `instructions` and `settings`. The extensions folders `~/.dimsum/extensions/` and `<workspace>/.dimsum/extensions/` follow the same split. See [Extensions](/extend/).

DimSum watches these files. Edits you make in an editor, or that come in with `git pull`, show up straight away. A file that isn't valid JSON, or doesn't match the format, is reported in the app and isn't used until it is fixed.

Each file can be up to 2 MB. If a save from the app would make a file larger than that, DimSum refuses the save and keeps the existing file as it was.

## instructions.json

The [instructions](/guide/personas-instructions#instructions) the composer offers.

```json
{
  "version": 1,
  "instructions": [
    {
      "kind": "toggle",
      "id": "run-tests",
      "label": "Run tests",
      "category": "Verification",
      "defaultOn": true,
      "text": "Run the test suite before you finish and report the result."
    },
    {
      "kind": "select",
      "id": "review-depth",
      "label": "Review depth",
      "display": "segmented",
      "defaultChoice": "normal",
      "choices": [
        { "id": "normal", "label": "Normal", "text": "" },
        { "id": "deep", "label": "Deep", "text": "Review every changed line and list each risk you find." }
      ]
    }
  ]
}
```

Every option has these fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `kind` | yes | `toggle`, `select`, `multiSelect` or `text`. |
| `id` | yes | A unique id. A workspace option with the same id as one of yours replaces yours in that workspace. |
| `label` | yes | What the menu shows. |
| `description` | no | Help text under the label. |
| `category` | no | Groups options in the menu. |
| `display` | no | `list`, `segmented` or `dropdown`, for choices. |
| `resetAfterSend` | no | Turn the option back to its default after each send. |
| `when` | no | Show the option only when a condition holds. See below. |

Each kind adds its own fields:

| Kind | Fields |
| --- | --- |
| `toggle` | `defaultOn` (boolean), `text` |
| `select` | `defaultChoice` (a choice id), `choices` |
| `multiSelect` | `defaultChoices` (choice ids), `choices` |
| `text` | `placeholder`, `defaultValue`, `maxLength` (1–10,000), `template`, in which `{{value}}` is replaced with what was typed |

A choice is `{ "id", "label", "text", "description"? }`. Its `text` is what it adds to the prompt.

### Conditions

`when` takes one condition:

| Condition | True when |
| --- | --- |
| `{ "kind": "isOn", "option": "<id>" }` | That toggle is on. |
| `{ "kind": "isChoice", "option": "<id>", "choice": "<choice id>" }` | That option has that choice selected. |
| `{ "kind": "harness", "harness": "claude.cli" }` | The session runs that harness (`claude.cli` or `codex.cli`). |
| `{ "kind": "all", "conditions": [ ... ] }` | Every condition holds. |
| `{ "kind": "any", "conditions": [ ... ] }` | At least one holds. |
| `{ "kind": "not", "condition": { ... } }` | The condition doesn't hold. |

Older versions of DimSum kept your own instructions in the app's profile, and DimSum moves them into these files when it starts. If a file can't take them yet, for example because it is invalid or its folder is read-only, they stay in your profile and still show in the composer. DimSum tries again on the next start.

Older versions also kept shared instructions in `.workbench/instructions.json`. That file is still read until `.dimsum/instructions.json` exists.

## settings.json

Small switches that layer the same way.

```json
{
  "version": 1,
  "extensions": {
    "disabled": ["workspace:level-editor", "user:my-panel"]
  }
}
```

`extensions.disabled` lists extensions to turn off, by id: `user:<folder name>` for yours and `workspace:<folder name>` for a workspace's. A layer can only add to the list, never take an entry away.

- A **workspace extension** can be turned off in any of the three files. Use the local file to turn it off just for yourself.
- **Your own extension** (`user:<name>`) runs in every workspace, so only `~/.dimsum/settings.json` turns it off. Listing it in a workspace's file has no effect.

The Extensions panel writes the right file for you.

## Other data

Your workspaces, open views, layout, drafts and personas aren't configuration. They are stored in your DimSum profile. See [Data and privacy](/reference/privacy).
