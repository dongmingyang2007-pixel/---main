import { HeroScene } from "@/components/public/HeroScene";
import { HighlightsScene } from "@/components/public/HighlightsScene";
import { EcosystemPreview } from "@/components/public/EcosystemPreview";
import { CraftScene } from "@/components/public/CraftScene";
import { CTAScene } from "@/components/public/CTAScene";
import { HOME_SCENES } from "@/lib/home-content";

export default function HomePage() {
  const [hero, highlights, ecosystem, craft, cta] = HOME_SCENES;

  return (
    <div>
      <HeroScene scene={hero} />
      <HighlightsScene scene={highlights} />
      <EcosystemPreview scene={ecosystem} />
      <CraftScene scene={craft} />
      <CTAScene scene={cta} />
    </div>
  );
}
