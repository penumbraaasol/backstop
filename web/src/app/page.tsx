import { CoverSection } from "@/components/CoverSection";
import { Footer } from "@/components/Footer";
import { HowItWorks } from "@/components/HowItWorks";
import { MyCover } from "@/components/MyCover";
import { Nav } from "@/components/Nav";

export default function Home() {
  return (
    <>
      <Nav />
      <main id="top">
        <CoverSection />
        <MyCover />
        <HowItWorks />
      </main>
      <Footer />
    </>
  );
}
