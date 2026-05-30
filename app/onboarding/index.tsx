import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";

// The post-signup onboarding flow. The routing dispatcher in app/_layout.tsx
// keeps the user on this route until OnboardingFlow calls setCompleted(true).
// All step state (current step, alias, rot level) is owned by OnboardingFlow +
// the onboarding store, so a mid-flow exit resumes where the user left off.
export default function Onboarding() {
  return <OnboardingFlow />;
}
