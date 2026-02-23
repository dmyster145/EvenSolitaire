/**
 * Even Hub SDK bridge: init, page setup, text/image updates, event subscription.
 */
import {
  waitForEvenAppBridge,
  TextContainerUpgrade,
  ImageRawDataUpdate,
  ImageRawDataUpdateResult,
  type EvenAppBridge as EvenAppBridgeType,
  type CreateStartUpPageContainer,
  type RebuildPageContainer,
  type EvenHubEvent,
} from "@evenrealities/even_hub_sdk";
import { log, warn, error } from "../utils/logger";

export type EvenHubEventHandler = (event: EvenHubEvent) => void;
export type ImageUpdatePriority = "high" | "normal" | "low";

type QueuedImageUpdate = {
  data: ImageRawDataUpdate;
  priority: number;
  coalesceKey: string | null;
  resolves: Array<(result: ImageRawDataUpdateResult | null) => void>;
};

function imagePriorityRank(priority: ImageUpdatePriority | undefined): number {
  switch (priority) {
    case "high":
      return 2;
    case "low":
      return 0;
    default:
      return 1;
  }
}

export class EvenHubBridge {
  private bridge: EvenAppBridgeType | null = null;
  private imageQueue: QueuedImageUpdate[] = [];
  private isSendingImage = false;
  private unsubscribeEvents: (() => void) | null = null;

  async init(): Promise<void> {
    try {
      this.bridge = await waitForEvenAppBridge();
      log("[EvenHubBridge] Bridge ready.");
    } catch (err) {
      warn("[EvenHubBridge] Bridge init failed (running outside Even Hub?):", err);
      this.bridge = null;
    }
  }

  getStorageBridge(): { getLocalStorage(key: string): Promise<string>; setLocalStorage(key: string, value: string): Promise<boolean> } | null {
    if (!this.bridge) return null;
    return {
      getLocalStorage: (key) => this.bridge!.getLocalStorage(key),
      setLocalStorage: (key, value) => this.bridge!.setLocalStorage(key, value),
    };
  }

  async setupPage(container: CreateStartUpPageContainer): Promise<boolean> {
    if (!this.bridge) {
      log("[EvenHubBridge] No bridge — skipping setupPage.");
      return false;
    }
    try {
      const result = await this.bridge.createStartUpPageContainer(container);
      const success = result === 0;
      if (!success) {
        error("[EvenHubBridge] createStartUpPageContainer failed:", result);
      }
      return success;
    } catch (err) {
      error("[EvenHubBridge] createStartUpPageContainer error:", err);
      return false;
    }
  }

  async rebuildPage(container: RebuildPageContainer): Promise<boolean> {
    if (!this.bridge) return false;
    try {
      return await this.bridge.rebuildPageContainer(container);
    } catch (err) {
      error("[EvenHubBridge] rebuildPageContainer error:", err);
      return false;
    }
  }

  async updateText(containerID: number, containerName: string, content: string): Promise<boolean> {
    if (!this.bridge) return false;
    try {
      return await this.bridge.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID,
          containerName,
          content,
        })
      );
    } catch (err) {
      error("[EvenHubBridge] textContainerUpgrade error:", err);
      return false;
    }
  }

  async updateImage(
    data: ImageRawDataUpdate,
    options?: { priority?: ImageUpdatePriority; coalesceKey?: string }
  ): Promise<ImageRawDataUpdateResult | null> {
    if (!this.bridge) return null;
    const resultPromise = new Promise<ImageRawDataUpdateResult | null>((resolve) => {
      this.enqueueImageUpdate(data, resolve, options);
    });
    await this.processImageQueue();
    return await resultPromise;
  }

  private enqueueImageUpdate(
    data: ImageRawDataUpdate,
    resolve: (result: ImageRawDataUpdateResult | null) => void,
    options?: { priority?: ImageUpdatePriority; coalesceKey?: string }
  ): void {
    const itemPriority = imagePriorityRank(options?.priority);
    const coalesceKey = options?.coalesceKey ?? null;
    if (coalesceKey) {
      const existingIndex = this.imageQueue.findIndex((item) => item.coalesceKey === coalesceKey);
      if (existingIndex >= 0) {
        const existing = this.imageQueue[existingIndex]!;
        existing.data = data;
        existing.resolves.push(resolve);
        if (itemPriority > existing.priority) existing.priority = itemPriority;
        if (existingIndex > 0) {
          this.imageQueue.splice(existingIndex, 1);
          this.insertQueuedImageUpdate(existing);
        }
        return;
      }
    }
    this.insertQueuedImageUpdate({
      data,
      priority: itemPriority,
      coalesceKey,
      resolves: [resolve],
    });
  }

  private insertQueuedImageUpdate(item: QueuedImageUpdate): void {
    const insertAt = this.imageQueue.findIndex((queued) => queued.priority < item.priority);
    if (insertAt < 0) {
      this.imageQueue.push(item);
      return;
    }
    this.imageQueue.splice(insertAt, 0, item);
  }

  private async processImageQueue(): Promise<void> {
    if (this.isSendingImage || !this.bridge) return;
    this.isSendingImage = true;
    try {
      while (this.imageQueue.length > 0) {
        const queued = this.imageQueue.shift()!;
        try {
          const result = await this.bridge.updateImageRawData(queued.data);
          if (!ImageRawDataUpdateResult.isSuccess(result)) {
            warn("[EvenHubBridge] Image update not successful:", result);
          }
          for (const resolve of queued.resolves) resolve(result);
        } catch (err) {
          error("[EvenHubBridge] Image update error:", err);
          for (const resolve of queued.resolves) resolve(null);
        }
      }
    } finally {
      this.isSendingImage = false;
    }
  }

  subscribeEvents(handler: EvenHubEventHandler): void {
    this.unsubscribeEvents?.();
    if (!this.bridge) {
      log("[EvenHubBridge] No bridge — skipping event subscription.");
      return;
    }
    try {
      this.unsubscribeEvents = this.bridge.onEvenHubEvent((event) => handler(event));
    } catch (err) {
      error("[EvenHubBridge] Event subscription error:", err);
      this.unsubscribeEvents = null;
    }
  }

  async shutdown(): Promise<void> {
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = null;
    if (this.bridge) {
      try {
        await this.bridge.shutDownPageContainer(0);
      } catch (err) {
        error("[EvenHubBridge] shutDown error:", err);
      }
    }
  }
}
