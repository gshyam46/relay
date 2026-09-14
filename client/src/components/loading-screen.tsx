import { BrandMark } from "@/components/brand-mark";
import "./loading-screen.css";

export function LoadingScreen({ compact = false, title, description }: { compact?: boolean; title?: string; description?: string }) {
  return <div className={"product-loading" + (compact ? " product-loading-compact" : "")} role="status" aria-live="polite" aria-busy="true">
    <div className="product-loading-mark" aria-hidden="true"><BrandMark /></div>
    <span className="product-loading-brand">Relay<span>.</span></span>
    <p className="product-loading-identity">AI Lead Intelligence &amp; Outbound Automation</p>
    <div className="product-loading-track" aria-hidden="true"><span/></div>
    <h2>{title || (compact ? "Loading your workspace" : "Getting things ready")}</h2>
    <p className="product-loading-note">{description || (compact ? "Bringing your saved work into view." : "A clearer next step starts here.")}</p>
    {!compact && <nav aria-label="Loading screen navigation"><a href="/register">Get started</a><a href="/login">Sign in</a></nav>}
  </div>;
}

export function LoadingState({label = "Loading workspace data"}: {label?: string}) { return <div className="product-loading-state" role="status" aria-live="polite" aria-busy="true"><span className="product-loading-ring" aria-hidden="true"/><p>{label}</p></div>; }
