# Vendored dependencies

## Screengrid 3.1.0

`screengrid-3.1.0.tgz` is an unpublished local build of Screengrid from commit
`775ef78` (`cell_semantics_rebased`). It was created with `npm pack` from a clean
working tree.

- SHA-256: `350fcf959db99c18a05c2cba22cb20d2e7f2e9095913c17e886f5cb68d4d8c5b`
- Used through `file:vendor/screengrid-3.1.0.tgz` in `package.json`.

When an equivalent or newer release is published, replace the `file:` dependency
with the registry version, run `npm install`, and remove the tarball.

## Glyphlens 0.1.0

`glyphlens-0.1.0.tgz` is an unpublished local build of Glyphlens from commit
`b6f2ed3` (`main`), created with `npm pack --ignore-scripts` — the
publish script rebuilds and tests, and the `dist/` in the tree is already the
built output. Its own suite passes at this commit (116 tests).

- SHA-256: `b7f21ca43df8182f881eb86b5e7ca7479cba3b61a64f426d0983877897b9a350`
- Used through `file:vendor/glyphlens-0.1.0.tgz` in `package.json`.

Pinned deliberately. The library is v0.1 and its README says the API will move;
a snapshot means that happens on our schedule rather than on every install.
When it is published, replace the `file:` dependency with the registry version,
run `npm install`, and remove the tarball.
