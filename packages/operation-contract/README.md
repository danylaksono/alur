# @alur/operation-contract

Types and validators for ALUR calculation plugins.

ALUR compiles against this package, and so does every plugin. That is the whole
point: a contract only one side can check is a contract only one side can get
right.

## Why it exists

The first plugin written against the prose version of the contract shipped two
mistakes that nothing caught:

- `options` declared as `{ value, label }` objects where the renderer wanted
  plain strings. It passed validation and rendered as `[object Object]`.
- `semanticType: "quantitative"`, which reads plausible and is not one of the
  seven ALUR has.

Both are type errors now, and both are caught by `operationManifestErrors`
before anything is served.

## Use

```ts
import { defineProvider, assertValidManifest } from '@alur/operation-contract';

export const provider = defineProvider({
  manifest: assertValidManifest({ /* … */ }),
  async create({ inputs, parameters }) { /* … */ },
});
```

In plain JavaScript, a JSDoc annotation gets the same checking in an editor with
no runtime dependency:

```js
/** @type {import('@alur/operation-contract').OperationManifest} */
const manifest = { /* … */ };
```

## What's in it

| | |
| --- | --- |
| `types.ts` | The calculation contract — manifest, lifecycle, inputs, changes, outputs. |
| `plugin.ts` | The package format: `alur.plugin.json`, the contract revision, and the catalogue shape. |
| `validate.ts` | `operationManifestErrors`, `pluginManifestErrors`, `pluginContentErrors` — exactly what ALUR runs on load. |
| `define.ts` | Identity helpers that exist for their types, plus `assert*` variants that throw. |

## Contract revision

`OPERATION_CONTRACT_REVISION` is bumped only when a change would break a plugin
that did not change. A plugin declares the revision it was written against, and
ALUR refuses one it does not speak — a clearer failure than the shape mismatch
that would otherwise surface deep inside a worker.

## Status

Not yet published to npm. ALUR consumes it through a path alias
(`vite.config.ts`, `tsconfig.json`, `vitest.config.ts`), and an external author
currently copies the types or vendors the package. Publishing it is the step that
makes the author-side half of this real for anyone outside this repository.
