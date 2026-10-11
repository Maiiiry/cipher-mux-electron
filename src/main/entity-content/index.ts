// Re-exports for all entity content generators
export { generateCompanionClaudeMd } from './companion-preset'
export { deployCompanionStartup } from './companion-startup'
export { deployCompanionGuides } from './companion-guides'
export { deployCompanionRef } from './companion-ref'
export { deployCompanionInfoPopup } from './companion-info-popup'
// Refinement und Ideation Partner haben je **eine** Vorlage, die englische neben
// ihrem Sync-Code. Bis zum 2026-10-11 lag hier zusaetzlich eine deutsche, die beim
// ersten Start die preset.md schrieb — und Korrekturen bekam, die die andere nicht
// bekam (und umgekehrt).
export { generateV2Template as generateRefinementClaudeMd } from '../refinement/refinement-template'
export { deployRefinementSkills } from './refinement-skills'
export { deployRefinementDirs } from './refinement-dirs'
export { generateV2Template as generateIdeationPartnerClaudeMd } from '../ideation-partner/ideation-template'
