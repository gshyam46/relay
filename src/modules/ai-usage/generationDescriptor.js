import { PIPELINE_VERSION } from "../lead-intelligence/intelligenceContract.js";
import { INTELLIGENCE_RECOMMENDATION_PIPELINE_VERSION } from "../lead-intelligence/intelligenceRecommendationContract.js";
import { NEXT_BEST_ACTION_PIPELINE_VERSION } from "../next-best-action/nextBestActionContract.js";
import { BUSINESS_FIT_VERSION } from "../lead-intelligence/businessFit.js";
import { SYNTHESIS_PIPELINE_VERSION, SYNTHESIS_PROMPT_VERSION } from "../lead-intelligence/synthesisContract.js";
import { identifier,hash } from "./aiUsageContract.js";
const descriptors=new WeakMap();
export const AI_ADAPTER_VERSION="l3.03-openai-compatible-v1";
export const AI_SYNTHESIS_SCHEMA_VERSION="l1-extractive-grounding-v1";
export function createGenerationDescriptor(provider=null) {
 const info=provider?.info;return Object.freeze({version:1,mode:provider?"MODEL":"DETERMINISTIC",provider:provider?identifier(info?.provider):null,model:provider?identifier(info?.model):null,pipeline_version:SYNTHESIS_PIPELINE_VERSION,prompt_version:provider?SYNTHESIS_PROMPT_VERSION:null,schema_version:AI_SYNTHESIS_SCHEMA_VERSION,adapter_version:provider?AI_ADAPTER_VERSION:null,pipeline_versions:Object.freeze({snapshot:PIPELINE_VERSION,recommendation:INTELLIGENCE_RECOMMENDATION_PIPELINE_VERSION,planner:NEXT_BEST_ACTION_PIPELINE_VERSION,business_fit:BUSINESS_FIT_VERSION})});
}
export function registerGenerationDescriptor(db,descriptor){const copy=structuredClone(descriptor);if(copy.pipeline_versions)Object.freeze(copy.pipeline_versions);const frozen=Object.freeze(copy);descriptors.set(db.rootDatabase||db,frozen);return frozen;}
export function getGenerationDescriptor(db){return descriptors.get(db.rootDatabase||db)||createGenerationDescriptor();}
export function generationFingerprint(descriptor){return hash(descriptor);}

export function synthesisGenerationDescriptor(descriptor){const {pipeline_versions,...synthesis}=descriptor;return synthesis;}
