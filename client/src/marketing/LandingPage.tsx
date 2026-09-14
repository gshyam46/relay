import { BrandMark } from "@/components/brand-mark";
import { LoadingScreen } from "@/components/loading-screen";
import { Component, Suspense, lazy, useState, type ReactNode } from "react";
import { ArrowDown, ArrowRight, ArrowUpRight, Check, ChevronDown, FileText, Layers3, LockKeyhole, Menu, Quote, ShieldCheck, X } from "lucide-react";
import { PilotRequestForm } from "./PilotRequestForm";
import "./landing.css";

const LandingDemo = lazy(() => import("./LandingDemo"));

class DemoBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <StaticExample failed /> : this.props.children; }
}

function StaticExample({ failed = false }: { failed?: boolean }) {
  return <div className="landing-static-example" aria-label="Readable example workflow">
    <div className="landing-static-label"><ShieldCheck size={16} />Interactive example — synthetic data. No messages are sent.</div>
    {failed && <p role="alert" className="landing-enhancement-error">The interactive example could not load. You can still read the workflow below or reload the page to try again.</p>}
    <div className="landing-static-flow">
      <div><span>01 / Source</span><Quote size={21} /><h3>“We need 12 workstations.”</h3><p>A fictional studio's enquiry names an interest and location. No budget is recorded.</p></div>
      <ArrowRight size={22} aria-hidden="true" />
      <div><span>02 / Intelligence</span><Layers3 size={21} /><h3>A match with an unknown.</h3><p>Interest matches the sample offering. Budget stays unknown, so business fit needs review.</p></div>
      <ArrowRight size={22} aria-hidden="true" />
      <div><span>03 / Next move</span><ShieldCheck size={21} /><h3>Review a useful question.</h3><p>An operator checks a clarification draft. A later opt-out would block further contact.</p></div>
    </div>
  </div>;
}

const workflow = [
  ["01", "Start with the enquiry.", "Bring your existing records together. Keep the original words and the context behind them."],
  ["02", "Find what matters.", "Understand how a lead fits your business, what you know and what you still need to ask."],
  ["03", "Give the next step a reason.", "Review a useful message, follow up at the right point and let the response inform what happens next."],
];

const questions = [
  ["Does the example send a message?", "No. It uses fictional enquiries and runs in your browser. Nothing is uploaded or sent."],
  ["Can I start with my existing enquiries?", "Yes. The application supports CSV import with a mapping review, original enquiry context and your own business criteria. Start with a small set of records you have permission to use."],
  ["Which live channels are available?", "Live sending is not yet available. You can explore the workflow in Sandbox. Tell us which channel matters to your business when you reach out; choosing one in the form records your interest, rather than enabling it."],
  ["What happens when I request a pilot?", "We save your contact details and workflow description for review. A demo time or pilot place is agreed separately. Sending a request does not create a workspace or confirm a booking."],
  ["What does the example prove?", "It shows how an enquiry can move from context to a reviewed decision. It uses synthetic data, so it does not demonstrate customer results or guarantee a business outcome."],
];

export function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  function openExample() { setMenuOpen(false); }

  return <div className="landing-page">
    <a href="#main-content" className="landing-skip-link">Skip to content</a>
    <header className="landing-header">
      <a href="/" className="landing-brand" aria-label="Relay — AI Lead Intelligence & Outbound Automation home">
        <BrandMark className="landing-brand-icon" />
        <span><strong>Relay</strong><small>AI Lead Intelligence<br />&amp; Outbound Automation</small></span>
      </a>
      <nav className="landing-desktop-nav" aria-label="Main navigation"><a href="#how-it-works">How it works</a><a href="#example" onClick={openExample}>Try it out</a><a href="#get-started">Getting started</a></nav>
      <div className="landing-header-actions">
        <a href="/login" className="landing-sign-in">Sign in<ArrowUpRight size={15} /></a>
        <a href="/register" className="landing-button landing-button-dark landing-header-cta">Get started<ArrowUpRight size={15} /></a>
        <button type="button" className="landing-menu-toggle" aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} aria-controls="landing-mobile-menu" onClick={() => setMenuOpen(value => !value)}>{menuOpen ? <X size={22} /> : <Menu size={22} />}</button>
      </div>
      {menuOpen && <nav id="landing-mobile-menu" className="landing-mobile-menu" aria-label="Mobile navigation"><a href="#how-it-works" onClick={() => setMenuOpen(false)}>How it works</a><a href="#example" onClick={openExample}>Try it out</a><a href="#get-started" onClick={() => setMenuOpen(false)}>Getting started</a><a href="/login">Sign in</a><a href="/register">Get started</a></nav>}
    </header>
    <main id="main-content">
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero-copy">
          <div className="landing-eyebrow"><span>Intelligence, before outreach.</span></div>
          <h1 id="landing-title">Your next move,<br />backed by what<br /><em>you know.</em></h1>
          <p>Every enquiry has a story. Bring the context together, understand who needs your attention and make the next conversation count.</p>
          <div className="landing-hero-actions"><a href="#example" onClick={openExample} className="landing-button landing-button-dark">Try it out<ArrowUpRight size={18} /></a><a href="/register" className="landing-text-link">Get started<ArrowRight size={17} /></a></div>
          <div className="landing-hero-note"><span className="landing-note-rule" /><span>Explore the product preview. Your review stays part of the process.</span></div>
        </div>
        <HeroVisual />
      </section>
      <div className="landing-loop-band">
        <span>From context to conversation</span>
        <div><span>Source</span><ArrowRight size={15} /><span>Intelligence</span><ArrowRight size={15} /><span>Review</span><ArrowRight size={15} /><span>Response</span></div>
        <a href="#example" onClick={openExample} aria-label="Try the interactive workflow"><ArrowDown size={18} /></a>
      </div>
      <section id="how-it-works" className="landing-workflow landing-section" aria-labelledby="workflow-title">
        <div className="landing-section-heading"><span className="landing-section-index">01 / A more considered workflow</span><h2 id="workflow-title">Good enquiries deserve<br />a considered next step.</h2><p>Less time piecing the story together. More context for the person taking it forward.</p></div>
        <div className="landing-workflow-rows">{workflow.map(([number, title, description]) => <article key={number}><span className="landing-row-number">{number}</span><div><h3>{title}</h3><p>{description}</p></div></article>)}</div>
      </section>
      <section id="example" className="landing-example-section" aria-labelledby="example-title">
        <div className="landing-section-heading"><span className="landing-section-index">02 / Try the workflow</span><div className="landing-example-heading-row"><h2 id="example-title">One enquiry.<br /><em>A decision you can follow.</em></h2><p>Choose an enquiry. Look at the evidence. See how a review or reply changes the next step.</p></div></div>
        <div className="landing-demo-mount"><DemoBoundary><Suspense fallback={<LoadingScreen compact title="Opening your interactive workspace" description="Try the workflow with sample enquiries. Nothing is sent." />}><LandingDemo /></Suspense></DemoBoundary></div>
        <p className="landing-example-caption">Product preview using fictional enquiries dated September 2026. No messages are sent. Some illustrated steps are still in development; live sending is not yet available.</p>
      </section>
      <section className="landing-control-section landing-section" aria-labelledby="control-title">
        <div className="landing-control-art" aria-hidden="true">
          <div className="landing-proof-heading"><span>Context, kept close.</span><FileText size={19} /></div>
          <div className="landing-proof-source"><span>Original enquiry</span><p>“We need 12 workstations…”</p><small>Sample source / Mira Shah</small></div>
          <div className="landing-proof-claim"><Check size={18} /><span>Interest: workstations<small>Supported by the original enquiry</small></span></div>
          <div className="landing-proof-unknown"><span>?</span><p>Budget: unknown<small>A useful question to ask next.</small></p></div>
          <div className="landing-proof-footer"><ShieldCheck size={16} />See the source. Make your own judgment.</div>
        </div>
        <div className="landing-control-copy"><span className="landing-section-index">03 / Clarity you can question</span><h2 id="control-title">Keep the reason<br /><em>within reach.</em></h2><p>A priority should come with an explanation. See the original enquiry, notice what is missing and decide whether to ask, follow up or leave it there.</p><ul><li><Check size={17} />The evidence stays with the assessment.</li><li><Check size={17} />You review the message before it moves forward.</li><li><Check size={17} />An opt-out stays a stop, even for a good fit.</li></ul><a href="#example" onClick={openExample} className="landing-text-link">Try it out<ArrowUpRight size={17} /></a></div>
      </section>
      <section id="get-started" className="landing-start-section landing-section" aria-labelledby="start-title">
        <div className="landing-section-heading"><span className="landing-section-index">04 / Begin with what you have</span><h2 id="start-title">Bring an enquiry.<br /><em>Build understanding.</em></h2><p>Explore the application, or talk through one workflow that matters to your business.</p></div>
        <div className="landing-start-grid">
          <article><span className="landing-start-number">01</span><div><h3>Make yourself at home.</h3><p>Create a Sandbox workspace, add your business context and work through a few enquiries. Sandbox does not send real messages.</p><a href="/register" className="landing-button landing-button-outline">Get started<ArrowUpRight size={16} /></a><a href="/app" className="landing-text-link landing-workspace-link">Already have a workspace? Open it<ArrowUpRight size={14} /></a></div></article>
          <article><span className="landing-start-number">02</span><div><h3>Start a conversation.</h3><p>Bring us a specific enquiry or follow-up problem. We can discuss whether a focused, supervised pilot is the right next step.</p><a href="#pilot" className="landing-button landing-button-outline">Share your workflow<ArrowUpRight size={16} /></a></div></article>
        </div>
      </section>
      <section className="landing-faq-section landing-section" aria-labelledby="questions-title">
        <div><span className="landing-section-index">A few practical questions</span><h2 id="questions-title">Clear expectations,<br />from the start.</h2></div>
        <div className="landing-faq-list">{questions.map(([question, answer]) => <details key={question}><summary>{question}<ChevronDown size={18} /></summary><p>{answer}</p></details>)}</div>
      </section>
      <section id="pilot" className="landing-pilot-section landing-section" aria-labelledby="pilot-title">
        <div className="landing-pilot-copy"><span className="landing-section-index">Let's begin with your business</span><h2 id="pilot-title">What gets lost<br />between the enquiry<br /><em>and the follow-up?</em></h2><p>Tell us about it. A useful conversation starts with the work you are trying to improve.</p><div><LockKeyhole size={17} /><span>We save your details to review your request. Please leave customer information out.</span></div></div>
        <PilotRequestForm />
      </section>
      <section className="landing-section landing-contact-section" aria-labelledby="contact-title"><div><span className="landing-section-index">A little more clarity</span><h2 id="contact-title">The next conversation<br /><em>starts here.</em></h2><p>Take a guided look at Relay, or tell us what you are working on.</p></div><div className="landing-hero-actions"><a href="#pilot" className="landing-button landing-button-dark">Book a demo<ArrowUpRight size={18} /></a><a href="#pilot" className="landing-button landing-button-outline">Reach out<ArrowUpRight size={18} /></a></div></section>
    </main>
    <footer className="landing-footer"><div><a href="/" className="landing-footer-brand"><BrandMark className="landing-footer-mark" />Relay</a><p>AI Lead Intelligence &amp; Outbound Automation</p></div><div><a href="#example" onClick={openExample}>Try it out</a><a href="/login">Sign in</a><a href="/product-information">Privacy and support</a><a href="#pilot">Book a demo</a><a href="#pilot">Reach out</a></div><p>Made for a more considered next step.<br />Product preview · Live sending is not yet available.</p></footer>
  </div>;
}

function HeroVisual() {
  return <div className="landing-hero-visual" aria-label="Synthetic enquiry preview">
    <div className="landing-visual-top"><span>THE ENQUIRY BRIEF</span><span>Synthetic preview / 01</span></div>
    <div className="landing-visual-person"><span className="landing-visual-avatar">MS</span><div><strong>Mira Shah</strong><span>Form Studio · Bengaluru</span></div><span className="landing-visual-type">New enquiry</span></div>
    <div className="landing-visual-source"><span className="landing-visual-label">In their own words</span><p>“We need <mark>12 workstations</mark><br />for our Bengaluru studio.”</p><span className="landing-source-tag"><FileText size={13} />Original enquiry attached</span></div>
    <div className="landing-visual-facts"><div><span className="landing-visual-label">What you know</span><strong><Check size={14} />Workstations</strong><span>Matches the sample offering</span></div><div><span className="landing-visual-label">What is missing</span><strong>Budget range</strong><span>Not yet recorded</span></div></div>
    <div className="landing-visual-decision"><div><span className="landing-visual-label">A considered next step</span><ArrowUpRight size={19} /></div><h3>Ask the useful question.</h3><p>Clarify the budget before recommending options.</p><span><ShieldCheck size={14} />Ready for your review</span></div>
    <div className="landing-visual-bottom"><span>Intelligence first. Your judgment, always.</span><span>RELAY / 001</span></div>
  </div>;
}
