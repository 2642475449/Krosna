import { invoke } from "@tauri-apps/api/core";
import { Update, type DownloadEvent, type DownloadOptions } from "@tauri-apps/plugin-updater";
import type { NetworkProxySettings } from "@/types";

interface UpdateMetadata {
  rid: number;
  currentVersion: string;
  version: string;
  body?: string;
  rawJson: Record<string, unknown>;
  host: string;
  alternate: [number, string] | null;
}

export interface ApplicationUpdate {
  currentVersion: string;
  version: string;
  body?: string;
  sources: { host: string; update: Update }[];
  downloadedFrom?: Update;
}

export async function checkApplicationUpdate(settings: NetworkProxySettings): Promise<ApplicationUpdate | null> {
  const metadata = await invoke<UpdateMetadata | null>("check_application_update", { settings });
  if (!metadata) return null;
  const sources = [{ host: metadata.host, update: new Update(metadata) }];
  if (metadata.alternate) {
    const [rid, host] = metadata.alternate;
    sources.push({ host, update: new Update({ ...metadata, rid }) });
  }
  return { currentVersion: metadata.currentVersion, version: metadata.version, body: metadata.body, sources };
}

export async function downloadApplicationUpdate(
  update: ApplicationUpdate,
  onEvent: (event: DownloadEvent) => void,
  options?: DownloadOptions,
): Promise<void> {
  const errors: string[] = [];
  for (const source of update.sources) {
    try {
      // 每个资源都走插件的签名校验，安装时复用实际通过验签的资源。
      await source.update.download(onEvent, options);
      update.downloadedFrom = source.update;
      return;
    } catch (error) {
      errors.push(`${source.host}: ${error instanceof Error ? error.message : String(error)}`);
      onEvent({ event: "Started", data: {} });
    }
  }
  throw new Error(errors.join("\n"));
}

export async function installApplicationUpdate(update: ApplicationUpdate): Promise<void> {
  if (!update.downloadedFrom) throw new Error("No verified update has been downloaded");
  await update.downloadedFrom.install();
}

export async function closeApplicationUpdate(update: ApplicationUpdate): Promise<void> {
  await Promise.all(update.sources.map((source) => source.update.close()));
}
