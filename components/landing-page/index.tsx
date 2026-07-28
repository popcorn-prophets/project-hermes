import { AuthButton } from '@/components/auth-button';
import { ErrorBoundary } from '@/components/error-boundary';
import Link from 'next/link';
import { Suspense } from 'react';
import { ChallengesSection } from './components/ChallengeSection';
import { ContactSection } from './components/ContactSection';
import { CTASection } from './components/CtaSection';
import { FaqSection } from './components/FaqSection';
import { FeatureSection } from './components/FeatureSection';
import Footer from './components/Footer';
import { NewHeroSection as HeroSection } from './components/HeroSection';
import { HowItWorks } from './components/HowItWorks';
import { AboutSection } from './components/IntroducingHermes';
import { Navbar } from './components/NavBar';
import { StatSection } from './components/StatSection';
import { TeamSection } from './components/TeamSection';
import { TestimonialsSection } from './components/Testimonials';
import { WebChatDemoSection } from './components/WebChatDemoSection';

export default function LandingPage() {
  return (
    <main className="min-h-screen flex flex-col items-center">
      <div className="flex-1 w-full flex flex-col gap-20 items-center">
        <Navbar
          desktopAuthButton={
            <ErrorBoundary fallback={<Link href="/auth/login">Sign in</Link>}>
              <Suspense>
                <AuthButton />
              </Suspense>
            </ErrorBoundary>
          }
          mobileAuthButton={
            <ErrorBoundary fallback={<Link href="/auth/login">Sign in</Link>}>
              <Suspense>
                <AuthButton fullWidth size="lg" />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <HeroSection />
        <ErrorBoundary
          fallback={
            <div className="w-full max-w-7xl px-4 py-12 text-center text-muted-foreground">
              The live chat and map demo is temporarily unavailable. Try opening
              the{' '}
              <Link href="/chat" className="underline">
                web chat
              </Link>{' '}
              or{' '}
              <Link href="/control-center" className="underline">
                control center
              </Link>{' '}
              directly.
            </div>
          }
        >
          <WebChatDemoSection />
        </ErrorBoundary>
        <StatSection />
        <ChallengesSection />
        <AboutSection />
        <FeatureSection />
        <HowItWorks />
        <TestimonialsSection />
        <FaqSection />
        <CTASection />
        <ContactSection />
        <TeamSection />
        <Footer />
      </div>
    </main>
  );
}
