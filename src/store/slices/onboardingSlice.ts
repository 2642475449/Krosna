import { create } from "zustand";

export const ONBOARDING_STEPS = [
  "appearance",
  "agents",
  "project",
  "preferences",
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];

interface OnboardingState {
  /** 是否已完成首次安装引导；初始为 false，仅在 SQLite 完成首次加载后决定是否自动弹出。 */
  onboardingCompleted: boolean;
  /** 是否已完成持久化状态水合。 */
  hydrated: boolean;
  /** 引导弹窗当前是否可见。 */
  modalOpen: boolean;
  /** 当前所在步骤。 */
  activeStep: OnboardingStepId;
  /** 本次打开弹窗已到达或完成的步骤集合。 */
  completedSteps: OnboardingStepId[];
  /** 从持久化设置同步引导完成状态；首次水合若未完成则自动打开引导。 */
  hydrateOnboardingCompleted: (completed: boolean) => void;
  /** 手动重新打开引导（如从设置页再次查看）。 */
  openOnboarding: () => void;
  /** 切换到指定步骤，并将先前步骤标记为已浏览。 */
  setActiveStep: (step: OnboardingStepId) => void;
  /** 前进到下一步；在最后一步时完成引导。 */
  nextStep: () => void;
  /** 返回上一步。 */
  prevStep: () => void;
  /** 完成引导并关闭弹窗。 */
  completeOnboarding: () => void;
  /** 跳过引导并关闭弹窗，不再自动弹出。 */
  skipOnboarding: () => void;
}

function appendUniqueStep(
  steps: OnboardingStepId[],
  step: OnboardingStepId,
): OnboardingStepId[] {
  return steps.includes(step) ? steps : [...steps, step];
}

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  onboardingCompleted: false,
  hydrated: false,
  modalOpen: false,
  activeStep: ONBOARDING_STEPS[0],
  completedSteps: [],

  hydrateOnboardingCompleted: (completed) => {
    const { hydrated, modalOpen, onboardingCompleted: wasCompleted } = get();
    set({
      onboardingCompleted: completed,
      hydrated: true,
      // 仅在首次水合未完成时自动打开，或在另一窗口刚完成首次引导（false -> true）时关闭；
      // 已完成状态下用户手动重新打开引导时，后续设置广播不能把它误关掉。
      modalOpen: !hydrated
        ? !completed
        : !wasCompleted && completed
          ? false
          : modalOpen,
    });
  },

  openOnboarding: () =>
    set({
      modalOpen: true,
      activeStep: ONBOARDING_STEPS[0],
      completedSteps: [],
    }),

  setActiveStep: (step) => {
    const { activeStep, completedSteps } = get();
    const currentIndex = ONBOARDING_STEPS.indexOf(activeStep);
    const targetIndex = ONBOARDING_STEPS.indexOf(step);
    const nextCompleted =
      targetIndex > currentIndex
        ? appendUniqueStep(completedSteps, activeStep)
        : completedSteps;
    set({
      activeStep: step,
      completedSteps: nextCompleted,
    });
  },

  nextStep: () => {
    const { activeStep, completedSteps } = get();
    const index = ONBOARDING_STEPS.indexOf(activeStep);
    const nextCompleted = appendUniqueStep(completedSteps, activeStep);
    if (index < ONBOARDING_STEPS.length - 1) {
      set({
        activeStep: ONBOARDING_STEPS[index + 1],
        completedSteps: nextCompleted,
      });
      return;
    }
    set({
      onboardingCompleted: true,
      modalOpen: false,
      completedSteps: nextCompleted,
    });
  },

  prevStep: () => {
    const { activeStep } = get();
    const index = ONBOARDING_STEPS.indexOf(activeStep);
    if (index > 0) {
      set({ activeStep: ONBOARDING_STEPS[index - 1] });
    }
  },

  completeOnboarding: () =>
    set({
      onboardingCompleted: true,
      modalOpen: false,
      completedSteps: [...ONBOARDING_STEPS],
    }),

  skipOnboarding: () =>
    set({
      onboardingCompleted: true,
      modalOpen: false,
    }),
}));
