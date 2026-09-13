import { IntelligenceService } from "./intelligenceService.js";
import { IntelligenceRepository } from "./intelligenceRepository.js";
import { SynthesisService } from "./synthesisService.js";
import { SynthesisRepository } from "./synthesisRepository.js";
import { ResearchEvidenceRepository } from "./researchEvidenceRepository.js";
import { IntelligenceRecommendationService } from "./intelligenceRecommendationService.js";
import { IntelligenceRecommendationRepository } from "./intelligenceRecommendationRepository.js";
import { NextBestActionService } from "../next-best-action/nextBestActionService.js";
import { NextBestActionRepository } from "../next-best-action/nextBestActionRepository.js";
import { InboundEventsRepository } from "../channels/inboundEventsRepository.js";

// Read composition never generates model output or mutates domain records.
// Adopted freshness evaluations may advance the technical workspace clock (ADR-017).
export function createCurrentIntelligenceServices(db, { now = Date.now } = {}) {
  const intelligenceRepository = new IntelligenceRepository(db);
  const intelligenceService = new IntelligenceService({ now, intelligenceRepository, inboundEventsRepository: new InboundEventsRepository(db) });
  const synthesisService = new SynthesisService({ now, synthesisRepository: new SynthesisRepository(db), intelligenceService,
    researchEvidenceRepository: new ResearchEvidenceRepository(db) });
  const intelligenceRecommendationService = new IntelligenceRecommendationService({ now, recommendationRepository: new IntelligenceRecommendationRepository(db),
    synthesisService, intelligenceRepository });
  const nextBestActionService = new NextBestActionService({ now, nextBestActionRepository: new NextBestActionRepository(db), intelligenceRecommendationService });
  return { intelligenceService, synthesisService, intelligenceRecommendationService, nextBestActionService };
}
