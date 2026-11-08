// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderInlineMarkdown } from "./MarkdownPreview";
import { readProjectImage } from "@/lib/api";

vi.mock("@/lib/api", () => ({ readProjectImage: vi.fn() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => `asset:${path}` }));

let container: HTMLDivElement;
let root: Root;
const localImage = (name = "diagram.png") => renderInlineMarkdown(`![Diagram](${name})`, {
  keyPrefix: "image", filePath: "D:/project/report.md", projectPath: "D:/project",
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(readProjectImage).mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("waits for the local file read before ever rendering an asset URL", () => {
  const markup = renderToStaticMarkup(localImage());
  expect(markup).not.toContain("<img");
  expect(markup).not.toContain("asset:");
});

it("preserves the read failure and resolved path, then reads the file again on retry", async () => {
  vi.mocked(readProjectImage).mockRejectedValueOnce(new Error("Access denied"));
  await act(async () => root.render(localImage()));
  expect(container.textContent).toContain("markdownImage.readFailed");
  expect(container.textContent).toContain("Access denied");
  expect(container.textContent).toContain("D:/project/diagram.png");
  expect(container.querySelector("img")).toBeNull();

  vi.mocked(readProjectImage).mockResolvedValueOnce({ dataUrl: "data:image/png;base64,recovered" } as Awaited<ReturnType<typeof readProjectImage>>);
  await act(async () => container.querySelector("button")!.click());
  expect(readProjectImage).toHaveBeenCalledTimes(2);
  expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,recovered");
  expect(container.textContent).not.toContain("Access denied");
});

it("distinguishes image display failure from file read failure and allows retry", async () => {
  const remoteImage = () => renderInlineMarkdown("![Diagram](https://example.com/diagram.png)", { keyPrefix: "remote" });
  await act(async () => root.render(remoteImage()));
  await act(async () => container.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(container.textContent).toContain("markdownImage.displayFailed");
  expect(container.textContent).not.toContain("markdownImage.readFailed");
  await act(async () => container.querySelector("button")!.click());
  expect(container.querySelector("img")?.getAttribute("src")).toBe("https://example.com/diagram.png");
  expect(readProjectImage).not.toHaveBeenCalled();
});

it("ignores an old file request that finishes after the image source changes", async () => {
  let finishOldRead!: (value: Awaited<ReturnType<typeof readProjectImage>>) => void;
  vi.mocked(readProjectImage).mockImplementationOnce(() => new Promise((resolve) => { finishOldRead = resolve; }));
  await act(async () => root.render(localImage("old.png")));
  vi.mocked(readProjectImage).mockResolvedValueOnce({ dataUrl: "data:image/png;base64,new" } as Awaited<ReturnType<typeof readProjectImage>>);
  await act(async () => root.render(localImage("new.png")));
  await act(async () => finishOldRead({ dataUrl: "data:image/png;base64,old" } as Awaited<ReturnType<typeof readProjectImage>>));
  expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,new");
});
