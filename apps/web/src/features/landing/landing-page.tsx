import { PublicLayout } from '@/components/layout/public-layout';
import { useScrollCalm } from './use-scroll-calm';
import { useSpotlight } from './use-spotlight';
import { useEffect } from 'react';
import { startSmoothScroll } from '@/lib/smooth-scroll';
import { useDocumentTitle } from '@/lib/use-document-title';
import { HeroSection } from './hero-section';
import { HowItWorksSection } from './how-it-works-section';
import { PrinciplesSection } from './principles-section';
import { PreviewSection } from './preview-section';
import { RolesSection } from './roles-section';
import { ScrollProgress } from './scroll-progress';
import { StatsSection } from './stats-section';

export function LandingPage() {
  useDocumentTitle();
  useSpotlight();
  useScrollCalm();
  useEffect(() => startSmoothScroll(), []);

  return (
    <PublicLayout>
      <ScrollProgress />
      <HeroSection />
      <StatsSection />
      <PreviewSection />
      <HowItWorksSection />
      <RolesSection />
      <PrinciplesSection />
    </PublicLayout>
  );
}
