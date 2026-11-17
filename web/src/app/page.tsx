import { CoverSection } from "@/components/CoverSection";
import { Footer } from "@/components/Footer";
import { Hero } from "@/components/Hero";
import { HowItWorks } from "@/components/HowItWorks";
import { MyCover } from "@/components/MyCover";
import { Nav } from "@/components/Nav";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <CoverSection />
        <HowItWorks />
        <MyCover />
      </main>
      <Footer />
    </>
  );
}
