#!/usr/bin/env python3
"""Build the comment-free web root for the Docker image.

The app is plain HTML/CSS/JS with no bundler, so there is nothing to
compile - but the published container should not ship source comments,
indentation or pretty-printed JSON. This script reads the working tree and
writes a separate output directory; it **never edits the source**, so the
readable checkout stays readable.

The Dockerfile runs it in a builder stage (`python3 tools/minify.py /app
/webroot`) and the runtime image only receives the output; the tool itself is
not served.

What "minify" means here, and what it deliberately cannot do
------------------------------------------------------------
The site is ~40 classic <script> files that share globals by *name* (`Utils`,
`CONFIG`, `window.PlayerController`) and address the DOM by *string* id
(`getElementById('headerToggle')`). Nothing can rename an identifier without
breaking those links, and there is no bundler to do it safely, so this script
does **not** mangle names, reorder statements or fold expressions. It:

  * strips every comment - respecting strings, template literals and regex
    literals, so `'https://example.com'` is not mistaken for a comment;
  * drops indentation and blank lines and collapses runs of spaces;
  * compacts CSS and JSON onto a single line;
  * keeps every newline that separated two statements in JS, so automatic
    semicolon insertion behaves exactly as it did, and every newline in HTML.

Each JS file is checked before it is published: the strings and template
literals of the output must match the input exactly, and `node --check` must
accept the result. Either failure aborts the build.

Usage:
    python3 tools/minify.py [SOURCE] [OUTPUT]

Defaults to `.` -> `_site`. The Dockerfile passes the paths explicitly.
`--no-check` skips the Node syntax check (the opaque-token comparison still
runs).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# What ships
# ---------------------------------------------------------------------------

# Directories that are development-only. `.nojekyll`, `CNAME` and
# `manifest.webmanifest` are served assets, so dotfiles are not skipped wholesale.
SKIP_DIRS = {
    ".git",
    "archive",
    "docker",      # build-only helpers (compose local overrides, etc.)
    "tools",       # this script
    "scripts",     # development tooling
    "node_modules",
    "__pycache__",
    "data",        # runtime content; the image mounts it as a volume
    "_site",       # this script's default output
    "_min",
    "3d-print",
    "temp",        # local archives and scratch files
    "logs",
    "Screenshots",
}

# Matched against the POSIX path relative to the source root, so only the
# top-level copies are dropped (Engine-V1/README.md and Engine-V1/LICENSE stay).
SKIP_FILES = {
    ".gitignore",
    ".dockerignore",
    ".env",
    ".env.local",
    "package.json",
    "README.md",
    "AGENTS.md",
    "docker-compose.yml",
    "docker-compose.dev.yml",
    "Dockerfile",
}

# `docs/` ships the rule book and the generated catalog; the generator inputs
# and prose are excluded by the fork's .gitignore and again here, so a local run
# produces the same tree CI checks out.
SKIP_PATHS = {
    "docs/detection",
    "docs/build_card_details.py",
    "docs/card-detection.json",
    "docs/card-details-README.md",
}

TEXT_KINDS = {
    ".js": "js",
    ".css": "css",
    ".html": "html",
    ".json": "json",
    ".webmanifest": "json",
}

# Elements whose contents must survive byte-for-byte: whitespace is content.
PROTECTED_TAGS = {"pre", "textarea"}

# ---------------------------------------------------------------------------
# JavaScript
# ---------------------------------------------------------------------------

_ID_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$")
# A `/` can only start a regex literal when the previous significant character
# cannot end an expression. `}` is deliberately absent: guessing wrong there
# would swallow real code, and a regex straight after a block is vanishingly
# rare, whereas missing one only leaves a regex unminified.
_REGEX_PRECEDERS = set("(,=:[!&|?{};+-*%~^<>")
_REGEX_KEYWORDS = {
    "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
    "case", "do", "else", "yield", "await", "throw",
}


def _scan_string(src: str, i: int, quote: str) -> int:
    """Return the index just past the string starting at `i` (never past a newline)."""
    n = len(src)
    j = i + 1
    while j < n:
        c = src[j]
        if c == "\\":
            j += 2
            continue
        if c == quote:
            return j + 1
        if c == "\n":          # unterminated - stop rather than swallow the file
            return j
        j += 1
    return n


def _scan_template(src: str, i: int) -> int:
    """Return the index just past the template literal starting at `i`."""
    n = len(src)
    j = i + 1
    while j < n:
        c = src[j]
        if c == "\\":
            j += 2
            continue
        if c == "`":
            return j + 1
        if c == "$" and src[j + 1:j + 2] == "{":
            j = _scan_braced(src, j + 2)
            continue
        j += 1
    return n


def _scan_braced(src: str, j: int) -> int:
    """Return the index just past the `}` matching an interpolation opened at `j`."""
    n = len(src)
    depth = 1
    while j < n:
        skipped = _skip_opaque(src, j)
        if skipped is not None:
            j = skipped
            continue
        c = src[j]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return j + 1
        j += 1
    return n


def _skip_opaque(src: str, i: int):
    """If a string, template or comment starts at `i`, return the index past it."""
    n = len(src)
    c = src[i]
    if c in "\"'":
        return _scan_string(src, i, c)
    if c == "`":
        return _scan_template(src, i)
    pair = src[i:i + 2]
    if pair == "//":
        end = src.find("\n", i + 2)
        return n if end < 0 else end        # keep the newline
    if pair == "/*":
        end = src.find("*/", i + 2)
        return n if end < 0 else end + 2
    return None


def _scan_regex(src: str, i: int) -> int:
    """Return the index just past the regex literal starting at `i`, else `i + 1`."""
    n = len(src)
    if src[i + 1:i + 2] == "*":
        return i + 1                        # `/*` - a comment, never a regex
    j = i + 1
    in_class = False
    while j < n:
        c = src[j]
        if c == "\\":
            j += 2
            continue
        if c == "[":
            in_class = True
        elif c == "]":
            in_class = False
        elif c == "/" and not in_class:
            j += 1
            break
        elif c == "\n":
            return i + 1                    # not a regex after all
        j += 1
    else:
        return i + 1
    while j < n and src[j].isalpha():       # flags
        j += 1
    return j


def _js_events(src: str):
    """Walk JS source, yielding `("code", char)` and `("opaque", token)` events.

    Both the minifier and the verifier consume this one walk, so the two agree
    on exactly what counts as a string by construction.
    """
    i = 0
    n = len(src)
    prev_sig = ""
    word = ""
    while i < n:
        c = src[i]
        pair = src[i:i + 2]

        # Comments are checked *before* the regex branch: `/*` and `//` can
        # never open a regex literal, but every character that legitimately
        # precedes one (`=`, `(`, `{`, `;`, `,`...) also precedes a comment.
        # Getting this order wrong silently leaves the comment in the output.
        if pair == "//":
            end = src.find("\n", i + 2)
            yield ("comment", " ")
            i = n if end < 0 else end      # keep the newline
            continue
        if pair == "/*":
            end = src.find("*/", i + 2)
            chunk = src[i:(n if end < 0 else end + 2)]
            yield ("comment", "\n" if "\n" in chunk else " ")
            i = n if end < 0 else end + 2
            continue

        if c == "/" and (
            prev_sig == "" or prev_sig in _REGEX_PRECEDERS or word in _REGEX_KEYWORDS
        ):
            end = _scan_regex(src, i)
            if end > i + 1:
                yield ("opaque", src[i:end])
                prev_sig, word = "/", ""
                i = end
                continue

        skipped = _skip_opaque(src, i)
        if skipped is not None:
            yield ("opaque", src[i:skipped])
            prev_sig, word = c, ""
            i = skipped
            continue

        yield ("code", c)
        if not c.isspace():
            prev_sig = c
            word = word + c if c in _ID_CHARS else ""
        i += 1


def minify_js(src: str) -> str:
    """Strip JS comments and indentation, preserving statement-separating newlines."""
    out: list[str] = []
    pending_space = False
    line_has_content = False

    def emit(ch: str) -> None:
        nonlocal pending_space, line_has_content
        if ch == "\n":
            if not line_has_content:
                return                     # blank line - drop it
            out.append("\n")
            line_has_content = False
            pending_space = False
            return
        if ch in " \t\r\f\v":
            if line_has_content:
                pending_space = True        # holds a run of spaces down to one
            return                          # leading indentation - drop it
        if pending_space:
            out.append(" ")
            pending_space = False
        out.append(ch)
        line_has_content = True

    for kind, value in _js_events(src):
        if kind == "code":
            emit(value)
        elif kind == "comment":
            if value == "\n":
                emit("\n")
            elif line_has_content:
                pending_space = True
        else:
            if pending_space and line_has_content:
                out.append(" ")
                pending_space = False
            out.append(value)
            # A token that spans lines (a template literal) leaves the line
            # counter mid-line, exactly as it was in the source.
            line_has_content = True

    return "".join(out)


def opaque_tokens(src: str) -> list[str]:
    """Every string and template literal, in order - used to prove a strip was lossless."""
    return [v for k, v in _js_events(src) if k == "opaque" and not v.startswith("/")]


def comment_count(src: str) -> int:
    """How many comments the JS walk finds - must be zero in the published output."""
    return sum(1 for kind, _ in _js_events(src) if kind == "comment")


# ---------------------------------------------------------------------------
# CSS
# ---------------------------------------------------------------------------

def minify_css(src: str) -> str:
    """Strip CSS comments and every scrap of whitespace that cannot matter."""
    n = len(src)
    i = 0
    chunks: list[str] = []
    while i < n:
        c = src[i]
        if c in "\"'":
            end = _scan_string(src, i, c)
            chunks.append(src[i:end])
            i = end
            continue
        if src[i:i + 2] == "/*":
            end = src.find("*/", i + 2)
            i = n if end < 0 else end + 2
            chunks.append(" ")              # a comment separates tokens
            continue
        if c.isspace():
            j = i
            while j < n and src[j].isspace():
                j += 1
            chunks.append(" ")
            i = j
            continue
        chunks.append(c)
        i += 1

    text = "".join(chunks)
    # Only whitespace that can never change meaning is removed. Space is kept
    # around `+`, `-`, `*` and `/` so `calc(100% - 10px)` survives, and kept
    # *before* `:` so a descendant selector like `a :hover` is not folded into
    # the pseudo-class `a:hover`.
    for pattern, replacement in (
        (r"\s*([{};,>])\s*", r"\1"),
        (r":\s+", ":"),
        (r"\s+!", "!"),
    ):
        text = re.sub(pattern, replacement, text)
    return text.strip()


# ---------------------------------------------------------------------------
# HTML
# ---------------------------------------------------------------------------

def _scan_tag(src: str, i: int) -> int:
    """Return the index just past the tag starting at `i`, honouring quoted attributes."""
    n = len(src)
    j = i + 1
    while j < n:
        c = src[j]
        if c in "\"'":
            j = _scan_string(src, j, c)
            continue
        if c == ">":
            return j + 1
        j += 1
    return n


def _tag_name(tag: str) -> str:
    body = tag.lstrip("<").lstrip("/").lstrip("!").lstrip("?")
    return "".join(ch for ch in body[:12].lower() if ch.isalnum())


def minify_html(src: str) -> str:
    """Strip HTML comments, compact tag-only whitespace, minify inline script/style.

    Whitespace-only text nodes become a single newline, which renders exactly as
    the original run did - unless the node sits in <pre> or <textarea>, where
    whitespace is content and everything is left alone. Text nodes that carry
    content are never touched, because `white-space: pre-wrap` / `pre-line`
    blocks (the Solo AI log, notes areas) preserve their line breaks.
    """
    n = len(src)
    i = 0
    out: list[str] = []
    protected = 0                                  # depth inside <pre>/<textarea>

    while i < n:
        if src.startswith("<!--", i):
            end = src.find("-->", i + 4)
            i = n if end < 0 else end + 3
            continue

        if src[i] == "<":
            end = _scan_tag(src, i)
            tag = src[i:end]
            name = _tag_name(tag)
            closing = tag.startswith("</")
            self_closing = tag.endswith("/>")

            if not closing and not self_closing and name in PROTECTED_TAGS:
                protected += 1
            elif closing and name in PROTECTED_TAGS and protected:
                protected -= 1

            out.append(tag)
            i = end

            # An inline <script>/<style> body is code, not markup.
            if not closing and not self_closing and name in {"script", "style"}:
                close = _find_close(src, i, name)
                body = src[i:close]
                if name == "style":
                    out.append(minify_css(body))
                elif "src=" not in tag.lower():
                    out.append(minify_js(body))
                else:
                    out.append(body)
                i = close
            continue

        # Text node.
        end = src.find("<", i)
        if end < 0:
            end = n
        text = src[i:end]
        if protected:
            out.append(text)
        elif text.strip():
            out.append(text)
        elif "\n" in text:
            out.append("\n")
        else:
            out.append(" ")
        i = end

    return "".join(out)


def _find_close(src: str, i: int, name: str) -> int:
    """Index of the `</name` that closes the element whose body starts at `i`."""
    needle = "</" + name
    j = src.lower().find(needle, i)
    return len(src) if j < 0 else j


# ---------------------------------------------------------------------------
# JSON
# ---------------------------------------------------------------------------

def minify_json(src: str) -> str:
    """Re-serialise pretty-printed JSON without whitespace (and validate it)."""
    return json.dumps(json.loads(src), separators=(",", ":"), ensure_ascii=False)


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------

def is_skipped(rel: Path) -> bool:
    if rel.name == ".env" or rel.name.startswith(".env."):
        return True                      # never copy local secrets
    if any(part in SKIP_DIRS for part in rel.parts[:-1]) or rel.parts[0] in SKIP_DIRS:
        return True
    posix = rel.as_posix()
    if posix in SKIP_FILES or posix in SKIP_PATHS:
        return True
    return any(posix == p or posix.startswith(p + "/") for p in SKIP_PATHS)


def rows():
    """Page paths used by the build's sanity check (kept here so CI and dev agree)."""
    return [
        "index.html",
        "404.html",
        "Engine-V2/player.html",
        "Engine-V2/admin.html",
        "Engine-V2/gm-console.html",
        "Engine-V2/custom-cards.html",
        "Engine-V2/scenario-library.html",
        "Engine-V1/index.html",
        "Engine-V1/help.html",
        "shared/catalogue.html",
        "shared/error.html",
    ]


def build(src_root: Path, out_root: Path, check: bool) -> int:
    # Guard the one case that could destroy the source: an output path that is
    # the source itself, or an ancestor of it (rmtree would take the source with
    # it). Writing to a *subdirectory* of the source is the normal `_site` case.
    if out_root.resolve() == src_root.resolve() or (
        out_root.resolve() in src_root.resolve().parents
    ):
        print("refusing to write over the source tree", file=sys.stderr)
        return 2

    if out_root.exists():
        shutil.rmtree(out_root)

    totals: dict[str, list[int]] = {}
    problems: list[str] = []
    js_out: list[Path] = []
    skipped = 0

    # Walk with pruning, and collect the source list up front: the walk writes
    # into out_root, and a live rglob would pick up the files it just created.
    entries: list[Path] = []
    for root, dirnames, filenames in os.walk(src_root):
        rel_root = Path(root).relative_to(src_root)
        keep = []
        for name in sorted(dirnames):
            rel = rel_root / name
            if rel.parts[0] == out_root.name or is_skipped(rel):
                skipped += 1
                continue
            keep.append(name)
        dirnames[:] = keep
        for name in sorted(filenames):
            rel = rel_root / name
            if is_skipped(rel):
                skipped += 1
                continue
            entries.append(Path(root) / name)

    for path in entries:
        rel = path.relative_to(src_root)
        target = out_root / rel

        target.parent.mkdir(parents=True, exist_ok=True)
        kind = TEXT_KINDS.get(path.suffix.lower())
        raw = path.read_bytes()

        if kind is None:
            shutil.copy2(path, target)
            continue

        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            shutil.copy2(path, target)
            continue

        try:
            if kind == "js":
                result = minify_js(text)
                if opaque_tokens(text) != opaque_tokens(result):
                    problems.append(f"{rel}: strings changed while stripping comments")
                    continue
                leftover = comment_count(result)
                if leftover:
                    problems.append(f"{rel}: {leftover} comment(s) survived")
                    continue
                js_out.append(rel)
            elif kind == "css":
                result = minify_css(text)
                if "/*" in result:
                    problems.append(f"{rel}: a comment survived")
                    continue
            elif kind == "html":
                result = minify_html(text)
                if "<!--" in result:
                    problems.append(f"{rel}: a comment survived")
                    continue
            else:
                result = minify_json(text)
        except Exception as error:                       # noqa: BLE001
            problems.append(f"{rel}: {error}")
            continue

        target.write_text(result, encoding="utf-8", newline="")
        bucket = totals.setdefault(path.suffix.lower() or "(none)", [0, 0])
        bucket[0] += len(raw)
        bucket[1] += len(result.encode("utf-8"))

    if check and js_out:
        node = shutil.which("node")
        if not node:
            print("warning: node not found - skipping the syntax check", file=sys.stderr)
        else:
            for rel in js_out:
                done = subprocess.run(
                    [node, "--check", str(out_root / rel)],
                    capture_output=True, text=True,
                )
                if done.returncode:
                    problems.append(f"{rel}: node --check failed\n{done.stderr.strip()}")

    before = sum(v[0] for v in totals.values())
    after = sum(v[1] for v in totals.values())
    print(f"{'kind':<14}{'before':>10}{'after':>10}{'saved':>9}")
    for ext in sorted(totals):
        b, a = totals[ext]
        print(f"{ext:<14}{b / 1024:>9.1f}K{a / 1024:>9.1f}K{100 * (b - a) / b:>8.0f}%")
    if before:
        print(f"{'TOTAL':<14}{before / 1024:>9.1f}K{after / 1024:>9.1f}K"
              f"{100 * (before - after) / before:>8.0f}%")
    else:
        print("nothing to minify")
    print(f"{skipped} development path(s) left out of the build")

    missing = [p for p in rows() if not (out_root / p).exists()]
    for rel in missing:
        problems.append(f"{rel}: expected in the build but missing")

    if problems:
        print("\nFAILED:", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("source", nargs="?", default=".")
    parser.add_argument("output", nargs="?", default="_site")
    parser.add_argument("--no-check", action="store_true",
                        help="skip the `node --check` syntax pass")
    args = parser.parse_args()
    return build(Path(args.source), Path(args.output), not args.no_check)


if __name__ == "__main__":
    sys.exit(main())
