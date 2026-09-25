import type { OnboardingStatus } from '../../hooks/useOnboardingStatus'

export type OnboardingStepId = 'model' | 'key' | 'request' | 'budget' | 'invite'

export interface OnboardingStep {
  id: OnboardingStepId
  title: string
  description: string
  done: boolean
  /** Where the primary action goes. */
  href: string
  actionLabel: string
}

export interface OnboardingViewer {
  isSystemAdmin: boolean
  isOrgAdmin: boolean
}

export const ONBOARDING_DISMISS_KEY = 'wai.onboarding.dismissed'

/** The steps this viewer can act on, ticked from the status response (missing status → not done). */
export function onboardingSteps(status: OnboardingStatus | undefined, viewer: OnboardingViewer): OnboardingStep[] {
  const all: { step: OnboardingStep; visible: boolean }[] = [
    {
      step: {
        id: 'model',
        title: 'Add a model',
        description: 'Register a provider model so requests have somewhere to go.',
        done: !!status?.has_models,
        href: '/models?new=1',
        actionLabel: 'Add model',
      },
      visible: viewer.isSystemAdmin,
    },
    {
      step: {
        id: 'key',
        title: 'Create an API key',
        description: 'Keys authenticate Cursor, the OpenAI SDK and your own apps.',
        done: !!status?.has_keys,
        href: '/keys?new=1',
        actionLabel: 'Create key',
      },
      visible: true,
    },
    {
      step: {
        id: 'request',
        title: 'Send your first request',
        description: 'Call the OpenAI-compatible endpoint with your key, or try the playground.',
        done: !!status?.has_requests,
        href: '/playground',
        actionLabel: 'Open playground',
      },
      visible: true,
    },
    {
      step: {
        id: 'budget',
        title: 'Set a budget',
        description: 'Cap organization spend so a runaway script can’t surprise you.',
        done: !!status?.has_budget,
        href: '/org/settings',
        actionLabel: 'Set budget',
      },
      visible: viewer.isOrgAdmin,
    },
    {
      step: {
        id: 'invite',
        title: 'Get your team signed in',
        description: 'Teammates join by signing in with Microsoft; then assign roles and teams.',
        done: !!status?.has_members,
        href: '/org/users',
        actionLabel: 'View members',
      },
      visible: viewer.isOrgAdmin,
    },
  ]
  return all.filter((s) => s.visible).map((s) => s.step)
}

export function readDismissed(storageKey: string): boolean {
  try {
    return window.localStorage.getItem(storageKey) === '1'
  } catch {
    return false
  }
}

export function writeDismissed(storageKey: string): void {
  try {
    window.localStorage.setItem(storageKey, '1')
  } catch {
    // Storage blocked (private mode etc.): dismissal lasts for this render only.
  }
}
