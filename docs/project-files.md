# What's in your project

Floorplan writes to exactly one place in your project: the `floorplan/` folder. It is not committed to git, and nothing else in your project is ever touched — no project notes, no git ignore lists, nothing outside the folder.

## The `floorplan/` folder

| File | What it is | Edit it? |
|---|---|---|
| `index.html` | The map: one self-contained page | No. Rebuilt every time |
| `graph.json` | Everything the map shows, as data | No. Rebuilt every time |
| `architecture.json` | The parts of your app, outside services, extra connections, flows and the tour | **Yes** |
| `descriptions/*.json` | The name and description of every file and endpoint, one file per part | **Yes** |
| `plan.json` | Blueprints only: the planned files, endpoints and screens, who may use each endpoint, the stack, assumptions and open questions. Names and descriptions live here instead of `descriptions/` | **Yes** |
| `recent-work.json` | What was just worked on, and why. Replaced on every update | Rarely. The AI writes it |
| `custom-flows.json` | Flows someone once requested from the map; kept so old maps don't lose them | Only to delete one |
| `health-dismissed.json` | Health issues you marked **Not a problem**, with your reasons | Only to undo one. **Show again** on the map does it too |
| `query.mjs` | Looks things up in the map from the command line | No |
| `artifact.html` | A copy without this machine's paths, only if you asked for one | No |
| `<project>-map.html` | An exported copy to share, only if you ran `serve.mjs --export` | No |
| `.cache/` | The scan, the description worksheets, the last update's changes, the driver's run log and result | No. Safe to delete |
| `.gitignore` | Keeps this whole folder out of git | No |

### Editing names and structure

Your edits to `architecture.json` and `descriptions/` are kept on every update. You can:
- rename a part, or reword a description;
- move files between parts by changing the `paths` patterns;
- add a connection the scan missed;
- pin a note to a file;
- add or change flows and the tour.

Or describe the change to whatever agent or model made the map ("rename 'Main server' to 'Shop API' on the floorplan").

A blueprint is edited the same way, through `plan.json` and `architecture.json`. The plan's format is in [`blueprint.md`](../skills/floorplan/references/blueprint.md).

The full format is in [`skills/floorplan/references/schema.md`](../skills/floorplan/references/schema.md), and the style guide for names and descriptions is in [`writing-descriptions.md`](../skills/floorplan/references/writing-descriptions.md).

## Staying out of git

- **`floorplan/`** contains its own `.gitignore` that ignores everything in the folder, including itself. Your `.gitignore` isn't changed, and the folder never appears in `git status`.
- Nothing else is written or ignored anywhere in your project.

The map is personal to each clone. Teammates who install Floorplan make their own.

If you committed a `floorplan/` folder before, ignoring it doesn't untrack those files. The build tells you the command that does, which keeps the files on disk:

```bash
git rm -r --cached floorplan
```
