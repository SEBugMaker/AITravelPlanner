import {
  HeroSection,
  FeaturesSection,
  HowItWorksSection,
  DemoSection,
  CTASection
} from "../components/landing";

export default function HomePage() {
  return (
    <div className="relative min-h-screen bg-slate-50">
      <div className="mx-auto flex max-w-6xl flex-col gap-12 px-6 py-16">
        <HeroSection />
        <FeaturesSection />
        <HowItWorksSection />
        <DemoSection />
        <CTASection />
      </div>
    </div>
  );
}
