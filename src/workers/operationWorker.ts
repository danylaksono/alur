import { createOperationHostCore, type OperationHostRequest } from '../services/operationHostCore';
import { BUNDLED_PLUGIN, BUNDLED_PROVIDERS } from '../providers';

/**
 * Where calculations run.
 *
 * A worker rather than the main thread, and not for responsiveness alone. A
 * provider is code from outside this repository, and running it here means the
 * rules it has to follow — no DOM, no map, no store — are enforced by the
 * runtime instead of by an author remembering them. It also makes loading a
 * provider from a URL an ordinary dynamic import rather than a redesign.
 *
 * The vite-ignore comment is deliberate: the whole point is that the URL is not
 * known at build time, so vite must not try to resolve it into the bundle.
 */
const core = createOperationHostCore(
  (url) => import(/* @vite-ignore */ url),
  undefined,
  [{ plugin: BUNDLED_PLUGIN, providers: BUNDLED_PROVIDERS }],
);

self.onmessage = async (event: MessageEvent<OperationHostRequest>) => {
  const response = await core.handle(event.data);
  self.postMessage(response);
};
