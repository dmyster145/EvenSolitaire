/**
 * Bridge-side page validation: setupPage/rebuildPage run the SDK's own
 * validateEvenHubPageContainer before the bridge call, aborting (with a clear
 * log) on an invalid page instead of shipping a doomed payload over BLE.
 *
 * Falsifiable: without the wired-in validation, an invalid page would reach the
 * fake bridge (which returns success), so setupPage would resolve true and
 * pageCalls would be non-empty — the opposite of what these assert.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerProperty,
  MenuContainerProperty,
  MenuItemProperty,
  validateEvenHubPageContainer,
} from "@evenrealities/even_hub_sdk";
import { EvenHubBridge } from "../../src/evenhub/bridge";
import { attachBridgeInstance, createFakeSdkBridge } from "./fake-bridge";
import {
  composeStartupPage,
  composeInputModePage,
  composeWinAnimationPage,
} from "../../src/render/page";
import { NATIVE_MENU_OPTIONS, nativeMenuItemID } from "../../src/state/constants";

function validText(): TextContainerProperty {
  return new TextContainerProperty({ containerID: 1, containerName: "t", content: "x" });
}

/** A menu with two items sharing itemID 1 — a DuplicateMenuItemID violation. */
function duplicateIdMenu(): MenuContainerProperty {
  return new MenuContainerProperty({
    menuItems: [
      new MenuItemProperty({ itemName: "a", itemID: 1 }),
      new MenuItemProperty({ itemName: "b", itemID: 1 }),
    ],
  });
}

function makeBridge() {
  const bridge = new EvenHubBridge();
  const fake = createFakeSdkBridge();
  attachBridgeInstance(bridge, fake);
  return { bridge, fake };
}

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  // The invalid-page path logs an error; silence it and let tests inspect it.
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errSpy.mockRestore();
});

describe("bridge aborts invalid pages before the bridge call", () => {
  it("setupPage sends a valid page through to the bridge", async () => {
    const { bridge, fake } = makeBridge();
    const ok = await bridge.setupPage(
      new CreateStartUpPageContainer({ containerTotalNum: 1, textObject: [validText()] })
    );
    expect(ok).toBe(true);
    expect(fake.pageCalls).toEqual(["create"]);
  });

  it("setupPage aborts an invalid page without calling the bridge", async () => {
    const { bridge, fake } = makeBridge();
    const page = new CreateStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [validText()],
      menuObject: duplicateIdMenu(),
    });
    expect(validateEvenHubPageContainer(page).valid).toBe(false); // sanity
    const ok = await bridge.setupPage(page);
    expect(ok).toBe(false);
    expect(fake.pageCalls).toEqual([]);
    expect(errSpy).toHaveBeenCalled();
  });

  it("rebuildPage sends a valid page through to the bridge", async () => {
    const { bridge, fake } = makeBridge();
    const ok = await bridge.rebuildPage(
      new RebuildPageContainer({ containerTotalNum: 1, textObject: [validText()] })
    );
    expect(ok).toBe(true);
    expect(fake.pageCalls).toEqual(["rebuild"]);
  });

  it("rebuildPage aborts an invalid page without calling the bridge", async () => {
    const { bridge, fake } = makeBridge();
    const page = new RebuildPageContainer({
      containerTotalNum: 1,
      textObject: [validText()],
      menuObject: duplicateIdMenu(),
    });
    const ok = await bridge.rebuildPage(page);
    expect(ok).toBe(false);
    expect(fake.pageCalls).toEqual([]);
  });
});

describe("every real page we build is valid (abort must never false-fire)", () => {
  it("startup / input-mode / win-animation pages pass SDK validation", () => {
    for (const page of [composeStartupPage(), composeInputModePage(), composeWinAnimationPage()]) {
      expect(validateEvenHubPageContainer(page).valid).toBe(true);
    }
  });

  it("the native menu shape we register passes validation", () => {
    const page = new CreateStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [validText()],
      menuObject: new MenuContainerProperty({
        menuItems: NATIVE_MENU_OPTIONS.map(
          (o) => new MenuItemProperty({ itemName: o, itemID: nativeMenuItemID(o) })
        ),
      }),
    });
    expect(validateEvenHubPageContainer(page).valid).toBe(true);
  });
});
