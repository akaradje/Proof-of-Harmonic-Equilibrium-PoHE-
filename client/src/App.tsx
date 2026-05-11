import { HUD } from "./components/HUD";
import { TemplateSelector } from "./components/TemplateSelector";
import { useState } from "react";

export type LayoutTemplate = "single" | "split" | "mosaic";

/**
 * Top-level scene. The HUD renders Liquid Information on top of a
 * Glassmorphism background; TemplateSelector chooses the layout slots.
 */
export function App() {
  const [template, setTemplate] = useState<LayoutTemplate>("single");

  return (
    <div className="scene">
      <div className="scene__bg" aria-hidden />
      <header className="scene__header">
        <h1>Proof of Harmonic Equilibrium</h1>
        <TemplateSelector value={template} onChange={setTemplate} />
      </header>
      <main className="scene__main">
        <HUD template={template} />
      </main>
    </div>
  );
}
