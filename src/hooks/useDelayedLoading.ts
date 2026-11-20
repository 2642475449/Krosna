import { useEffect, useState } from "react";

const DEFAULT_LOADING_DELAY_MS = 200;

/**
 * Delays showing a loading indicator so fast local file reads feel instantaneous.
 */
export function useDelayedLoading(loading: boolean, delayMs = DEFAULT_LOADING_DELAY_MS): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!loading) {
      setVisible(false);
      return;
    }

    const timer = globalThis.setTimeout(() => {
      setVisible(true);
    }, delayMs);

    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [delayMs, loading]);

  return loading && visible;
}
