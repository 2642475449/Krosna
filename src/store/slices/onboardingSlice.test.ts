import { beforeEach, describe, expect, it } from "vitest";
import { ONBOARDING_STEPS, useOnboardingStore } from "./onboardingSlice";

function resetStore() {
  useOnboardingStore.setState({
    onboardingCompleted: false,
    hydrated: false,
    modalOpen: false,
    activeStep: ONBOARDING_STEPS[0],
    completedSteps: [],
  });
}

describe("onboardingSlice", () => {
  beforeEach(() => {
    resetStore();
  });

  it("opens modal automatically on first hydration when onboarding is not completed", () => {
    useOnboardingStore.getState().hydrateOnboardingCompleted(false);
    const state = useOnboardingStore.getState();
    expect(state.hydrated).toBe(true);
    expect(state.onboardingCompleted).toBe(false);
    expect(state.modalOpen).toBe(true);
  });

  it("keeps modal closed on first hydration for existing users", () => {
    useOnboardingStore.getState().hydrateOnboardingCompleted(true);
    const state = useOnboardingStore.getState();
    expect(state.hydrated).toBe(true);
    expect(state.onboardingCompleted).toBe(true);
    expect(state.modalOpen).toBe(false);
  });

  it("advances through all steps and completes on the final step", () => {
    useOnboardingStore.getState().openOnboarding();
    expect(useOnboardingStore.getState().activeStep).toBe("appearance");

    useOnboardingStore.getState().nextStep();
    expect(useOnboardingStore.getState().activeStep).toBe("agents");
    expect(useOnboardingStore.getState().completedSteps).toEqual(["appearance"]);

    useOnboardingStore.getState().prevStep();
    expect(useOnboardingStore.getState().activeStep).toBe("appearance");

    useOnboardingStore.getState().nextStep();
    useOnboardingStore.getState().nextStep();
    useOnboardingStore.getState().nextStep();
    expect(useOnboardingStore.getState().activeStep).toBe("preferences");

    useOnboardingStore.getState().nextStep();
    const finalState = useOnboardingStore.getState();
    expect(finalState.onboardingCompleted).toBe(true);
    expect(finalState.modalOpen).toBe(false);
    expect(finalState.completedSteps).toEqual([...ONBOARDING_STEPS]);
  });

  it("marks onboarding completed and closes modal when skipped", () => {
    useOnboardingStore.getState().hydrateOnboardingCompleted(false);
    expect(useOnboardingStore.getState().modalOpen).toBe(true);

    useOnboardingStore.getState().skipOnboarding();
    const state = useOnboardingStore.getState();
    expect(state.onboardingCompleted).toBe(true);
    expect(state.modalOpen).toBe(false);
  });

  it("allows reopening onboarding manually after completion", () => {
    useOnboardingStore.getState().hydrateOnboardingCompleted(true);
    useOnboardingStore.getState().openOnboarding();

    // 模拟弹窗打开期间触发设置同步广播（onboardingCompleted 仍为 true），不应误关闭弹窗
    useOnboardingStore.getState().hydrateOnboardingCompleted(true);

    const state = useOnboardingStore.getState();
    expect(state.modalOpen).toBe(true);
    expect(state.activeStep).toBe("appearance");
    expect(state.completedSteps).toEqual([]);
  });

  it("closes auto-opened modal if another window finishes onboarding", () => {
    useOnboardingStore.getState().hydrateOnboardingCompleted(false);
    expect(useOnboardingStore.getState().modalOpen).toBe(true);

    useOnboardingStore.getState().hydrateOnboardingCompleted(true);
    expect(useOnboardingStore.getState().modalOpen).toBe(false);
    expect(useOnboardingStore.getState().onboardingCompleted).toBe(true);
  });
});
