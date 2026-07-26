import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { STORY_URL_PARAM, fetchStory } from '../services/storyService';

export type StoryLinkState =
  | { status: 'idle' }
  | { status: 'loading'; url: string }
  | { status: 'failed'; url: string; message: string };

/**
 * Opens a story named by `?story=<url>` on load.
 *
 * The parameter is dropped from the address bar once handled so a reload or a
 * "Close story" does not silently re-open it, and so the workspace URL never
 * carries someone else's link around.
 */
export const useStoryLink = () => {
  const openStory = useStore((state) => state.openStory);
  const [state, setState] = useState<StoryLinkState>({ status: 'idle' });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const target = params.get(STORY_URL_PARAM);
    if (!target) return;

    const clearParam = () => {
      params.delete(STORY_URL_PARAM);
      const query = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
    };

    let cancelled = false;
    setState({ status: 'loading', url: target });
    fetchStory(target)
      .then((story) => {
        if (cancelled) return;
        openStory(story);
        setState({ status: 'idle' });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ status: 'failed', url: target, message: error instanceof Error ? error.message : 'The story could not be loaded.' });
      })
      .finally(clearParam);

    return () => { cancelled = true; };
  }, [openStory]);

  return { state, dismiss: () => setState({ status: 'idle' }) };
};
