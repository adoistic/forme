# Vendored dependencies

Forme vendors source from upstream repos when the dependency is solo-maintained
or carries high bus-factor risk per the engineering review (eng-plan §1).

## Current vendors

### `pretext/` — `@chenglou/pretext`

- **Upstream:** https://github.com/chenglou/pretext
- **License:** see `vendor/pretext/LICENSE`
- **Vendored commit:** `f2014338487a20248192d6f6e953a94dc8414ab7`
- **Vendored on:** 2026-04-22
- **Rationale:** solo-maintainer (`@chenglou`). The eng review flagged
  bus-factor risk per outside-voice finding 5. Vendoring from day 1
  means a quiet-maintainer event doesn't block Forme. We update the
  vendor by checking the upstream diff and re-importing when we need a fix.

## How to update a vendor

```bash
# 1. Re-clone at desired ref
git clone --depth 1 https://github.com/chenglou/pretext.git /tmp/pretext-new
cd /tmp/pretext-new && git rev-parse HEAD  # record the new commit

# 2. Diff against current vendored copy
diff -r /tmp/pretext-new "$REPO/vendor/pretext"

# 3. Replace if the diff looks acceptable
rm -rf "$REPO/vendor/pretext"
cp -r /tmp/pretext-new "$REPO/vendor/pretext"
rm -rf "$REPO/vendor/pretext/.git"

# 4. Update this file with the new commit hash + date
# 5. Run tests, commit with "chore(vendor): bump pretext to <sha>"
```

## What NOT to vendor

- Mainstream libraries with many maintainers (react, electron, etc.) —
  these are pinned via package.json.
- Libraries we'd rather contribute back to (file a PR, don't fork).
- Libraries we don't use (tree-shake aggressively; if vendored source
  grows unused, remove it).
