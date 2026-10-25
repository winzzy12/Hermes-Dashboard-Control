"""Skills: scan installed SKILL.md files + enabled/disabled state from the CLI.

Skill layout: $HERMES_HOME/skills/<category>/<skill>/SKILL.md or
$HERMES_HOME/skills/<skill>/SKILL.md. Enable/disable state comes from
`hermes skills list --source local` (parsed from the rendered table); when the
table can't be parsed, status falls back to 'unknown' — never guessed.
"""
import pathlib
import re

from .. import config
from . import cli


def _frontmatter(text: str) -> dict:
    m = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
    if not m:
        return {}
    out = {}
    for line in m.group(1).splitlines():
        if ":" in line and not line.startswith((" ", "\t")):
            k, _, v = line.partition(":")
            out[k.strip().lower()] = v.strip().strip('"').strip("'")
    return out


def _status_map() -> dict[str, str]:
    # `hermes skills list` (all sources) carries enabled/disabled for builtin+local
    try:
        out = cli.run_cli_checked(["skills", "list"], timeout=90)
    except cli.HermesError:
        return {}
    statuses: dict[str, str] = {}
    for line in out.splitlines():
        if "│" not in line:
            continue
        cells = [c.strip() for c in line.split("│")]
        if len(cells) < 6 or not cells[1] or cells[1] in ("Name",):
            continue
        status = cells[5].lower()
        statuses[cells[1]] = status if status in ("enabled", "disabled") else "unknown"
    return statuses


def list_skills() -> list[dict]:
    root = config.HERMES_HOME / "skills"
    skills: list[dict] = []
    if root.is_dir():
        for sm in sorted(root.glob("**/SKILL.md")):
            rel = sm.relative_to(root)
            parts = rel.parts  # (<skill>/SKILL.md) or (<category>/<skill>/SKILL.md)
            name = parts[-2] if len(parts) >= 2 else sm.parent.name
            category = parts[0] if len(parts) >= 3 else ""
            try:
                text = sm.read_text(errors="replace")[:20000]
            except OSError:
                continue
            fm = _frontmatter(text)
            body_start = text.find("---", 3)
            body = text[body_start + 3:].strip() if body_start != -1 else text
            skills.append({
                "name": fm.get("name", name),
                "slug": name,
                "description": fm.get("description", ""),
                "category": category,
                "path": str(sm),
            })
    statuses = _status_map()
    for s in skills:
        s["status"] = statuses.get(s["name"], statuses.get(s["slug"], "unknown"))
    skills.sort(key=lambda s: (s["category"], s["name"]))
    return skills


def skill_detail(slug: str) -> dict | None:
    for s in list_skills():
        if s["slug"] == slug or s["name"] == slug:
            try:
                content = pathlib.Path(s["path"]).read_text(errors="replace")
            except OSError:
                content = ""
            return {**s, "content": content}
    return None
