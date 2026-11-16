import { useEffect } from "react";
import { useAppStore } from "@/store";
import { readProjectFile } from "@/lib/api";
import { pixelPetFileLocation, watchPixelPetFile } from "@/lib/pixelPetFile";

/** Main-window lifetime, independent of settings visibility and the current project. */
export function usePixelPetFileSync(enabled: boolean) {
  const path = useAppStore((state) => state.pixelPetFilePath);
  const revision = useAppStore((state) => state.pixelPetFileRevision);
  useEffect(() => {
    if (!enabled || !path) return;
    let directory: string;
    try { directory = pixelPetFileLocation(path).directory; }
    catch (error) { useAppStore.setState({ pixelPetFileError: String(error) }); return; }
    const isCurrent = () => useAppStore.getState().pixelPetFilePath === path && useAppStore.getState().pixelPetFileRevision === revision;
    return watchPixelPetFile({
      read: () => readProjectFile(directory, path),
      onLoad: (config, snapshot) => {
        if (isCurrent()) useAppStore.setState({ pixelPetConfig: config, pixelPetFileSnapshot: snapshot, pixelPetFileError: null });
      },
      onError: (error) => {
        if (isCurrent() && useAppStore.getState().pixelPetFileError !== error) useAppStore.setState({ pixelPetFileError: error });
      },
    });
  }, [enabled, path, revision]);
}
