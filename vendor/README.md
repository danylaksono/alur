# Vendored dependencies

## Screengrid 3.1.0

`screengrid-3.1.0.tgz` is an unpublished local build of Screengrid from commit
`775ef78` (`cell_semantics_rebased`). It was created with `npm pack` from a clean
working tree.

- SHA-256: `350fcf959db99c18a05c2cba22cb20d2e7f2e9095913c17e886f5cb68d4d8c5b`
- Used through `file:vendor/screengrid-3.1.0.tgz` in `package.json`.

When an equivalent or newer release is published, replace the `file:` dependency
with the registry version, run `npm install`, and remove the tarball.

## Glyphlens 0.1.1

`glyphlens-0.1.1.tgz` is an unpublished local build of Glyphlens from commit
`acb80c0` (`main`), created with `npm pack --ignore-scripts` — the
publish script rebuilds and tests, and the `dist/` in the tree is already the
built output. Its own suite passes at this commit (117 tests).

- SHA-256: `02a7f8046fd9e41e7ba2789412b98a49b9ef25a50078297bfdba4787cbbf8172`
- Used through `file:vendor/glyphlens-0.1.1.tgz` in `package.json`.

Pinned deliberately. The library is v0.1 and its README says the API will move;
a snapshot means that happens on our schedule rather than on every install.
When it is published, replace the `file:` dependency with the registry version,
run `npm install`, and remove the tarball.

0.1.1 carries a fix found from here: `aggregate` multiplied by `it.weight`,
which only the areal and corridor selectors set, so a `measure` spec over
points divided by NaN and every bin came back 0. That is what unblocks the
lens's mean reading.

Note for the next bump: npm keys its cache on name and version, so re-packing
the same version leaves a stale copy in `node_modules` no matter what the
tarball says. Bump the library's version rather than trying to reinstall over
the top of it.
