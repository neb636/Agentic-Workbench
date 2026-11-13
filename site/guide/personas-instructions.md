# Personas and instructions

The composer has two menus that add text to your prompt without you typing it each time.

## Personas

A persona is a block of text that goes before your prompt, such as "You are reviewing this change as a security engineer". Choose one from the **Personas** menu in the composer. It applies to the next send only, and the choice clears after you send.

Create and edit personas in **Settings ▸ Personas**. Each one has a name, a description and the instructions text, and is available either in every workspace or only in one. Personas are kept in your DimSum profile.

## Instructions

Instructions are options whose text goes after your prompt. Unlike a persona, an instruction stays on from one send to the next until you turn it off. An option can be:

- a **toggle**, such as *Write report*;
- a **choice** of one, shown as a list, a segmented control or a dropdown;
- a **multi-select**;
- a **text** field filled into a template, such as *Focus the new tests on {value}*.

An option can appear only when something else is true, for example only when another option is on, or only for one harness.

DimSum starts you with a few: *Create issue*, *Open PR*, *Write report*, *Unit tests*, *Test focus* and *Extension guide*. Edit or delete them like any other. **Restore default instructions** brings back the ones you deleted.

## Who gets an instruction

Every instruction lives in one of three places. In **Settings ▸ Instructions**, **Who gets it** moves it between them:

| Choice | Stored in | Who sees it |
| --- | --- | --- |
| Everywhere | `~/.dimsum/instructions.json` | You, in every workspace. |
| Shared in repo | `<workspace>/.dimsum/instructions.json` | Everyone who works in the repository, once you commit the file. |
| Only me here | `<workspace>/.dimsum/instructions.local.json` | You, in this workspace only. DimSum keeps it out of Git. |

When a shared instruction has the same id as one of yours, the shared one wins in that repository, so a team's version takes precedence. You can turn off instructions you don't want in a particular workspace, and that only affects you.

The file format is described in [Configuration files](/configure/config-files).
