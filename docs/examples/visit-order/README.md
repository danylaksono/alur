# Example: order into a visiting sequence

The finished code from
[Building your first calculation](../../building-your-first-calculation.md).

Deliberately the smallest complete calculation: one input, one setting, one
change the analyst can assert, one joined output, one nominated measure. Nothing
here is decorative — remove any of it and some part of the contract stops being
demonstrated.

It orders a set of stops by repeatedly moving to the nearest one not yet visited.
That is a calculation rather than a query because the next choice depends on
everywhere already visited, which no single `SELECT` can express.

## Run the checks

```sh
node verify.mjs
```

Drives the whole contract against four stops in a line plus one with no geometry:
the manifest, the lifecycle, both orderings of a repeated change, nulls for
unrouted stops, and — the one that matters — that replaying an earlier change
list reproduces its result byte for byte.

ALUR's own test suite also runs this manifest through the real validator
(`src/services/exampleProvider.test.ts`), so the tutorial cannot drift from the
contract it teaches.

## Load it into ALUR

```sh
npx serve --cors -l 8733 .
```

Then paste `http://localhost:8733/alur.plugin.json` into the toolbox's **Add a
plugin** box.

## Copy it

Copy this directory, rename it, change the `id` and `name` to something of your
own, and replace `evaluate`. Everything structural is already in place.
