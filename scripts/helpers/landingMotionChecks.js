import assert from "node:assert/strict";
import path from "node:path";

const revealSelector = "#get-started[data-reveal], #get-started [data-reveal]";
const heroSelector = ".landing-hero-visual";
const sourceSelector = ".landing-visual-source";

async function until(read, accepts, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  let value;
  do {
    value = await read();
    if (accepts(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 30));
  } while (Date.now() < deadline);
  throw new Error(label + ": " + JSON.stringify(value));
}

async function paint(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function motionState(page) {
  return page.locator(".landing-page").evaluate(root => {
    const source = root.querySelector(".landing-visual-source");
    const hero = root.querySelector(".landing-hero-visual");
    const active = root.getAnimations({ subtree: true }).filter(animation => animation.playState === "running" || animation.pending);
    const hidden = [...root.querySelectorAll("[data-reveal]")].filter(element => {
      const style = getComputedStyle(element);
      return Number(style.opacity) < .99 || style.visibility !== "visible" || style.display === "none";
    });
    return {
      enabled: root.dataset.motion === "enabled",
      active: active.length,
      hidden: hidden.length,
      x: Number(getComputedStyle(hero).getPropertyValue("--hero-pointer-x") || 0),
      y: Number(getComputedStyle(hero).getPropertyValue("--hero-pointer-y") || 0),
      translate: getComputedStyle(source).translate,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
}

function assertResting(state, label) {
  assert.equal(state.enabled, false, label + ": enhancement disabled");
  assert.equal(state.active, 0, label + ": animations stopped");
  assert.equal(state.hidden, 0, label + ": readable reveal content");
  assert.equal(state.x, 0, label + ": horizontal pointer offset reset");
  assert.equal(state.y, 0, label + ": vertical pointer offset reset");
  const offsets = state.translate.match(/-?[\d.]+/g) || ["0"];
  assert.ok(offsets.every(value => Math.abs(Number(value)) < .1), label + ": card translation reset, got " + state.translate);
  assert.equal(state.overflow, false, label + ": no horizontal overflow");
}

async function keyboardExample(page) {
  const link = page.getByRole("link", { name: "Try it out", exact: true }).first();
  await link.focus();
  await page.keyboard.press("Enter");
  await until(() => new URL(page.url()).hash, value => value === "#example", "Keyboard CTA reaches example");
  const demo = page.getByLabel("Interactive synthetic product example", { exact: true });
  await demo.waitFor({ state: "visible" });
  assert.match(await demo.locator('[aria-current="step"]').innerText(), /Source$/);
  return demo;
}

async function hoverHero(page) {
  const bounds = await page.locator(heroSelector).boundingBox();
  assert.ok(bounds && bounds.width > 0 && bounds.height > 0, "Hero has a visible pointer surface");
  await page.mouse.move(bounds.x + bounds.width * .8, bounds.y + bounds.height * .3);
}

export async function verifyLandingMotion({ browser, base, artifacts, pass }) {
  async function scenario(name, options, check) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, reducedMotion: "no-preference", ...options });
    context.setDefaultTimeout(20000);
    const errors = [], writes = [];
    let page;
    try {
      await context.route("**/*", route => {
        const request = route.request();
        if (!["GET", "HEAD"].includes(request.method())) {
          writes.push(request.method() + " " + new URL(request.url()).pathname);
          return route.abort();
        }
        return request.url().startsWith(base + "/") ? route.continue() : route.abort();
      });
      await context.addInitScript(() => {
        const original = Element.prototype.animate;
        window.__landingMotionTest = [];
        Element.prototype.animate = function (...args) {
          const animation = original.apply(this, args);
          window.__landingMotionTest.push({ target: this, animation });
          return animation;
        };
      });
      page = await context.newPage();
      page.on("pageerror", error => errors.push(error.name + ": " + error.message));
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      await check(page);
      assert.deepEqual(errors, [], name + ": no browser runtime errors");
      assert.deepEqual(writes, [], name + ": no registration, data or provider writes");
    } catch (error) {
      await page?.screenshot({ path: path.join(artifacts, name + "-failure.png"), fullPage: true }).catch(() => {});
      throw error;
    } finally {
      await context.close();
    }
  }

  await scenario("landing-motion-normal", {}, async page => {
    await page.goto(base + "/", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 1 }).waitFor({ state: "visible" });
    await until(() => motionState(page), value => value.enabled, "Normal motion becomes available");
    await until(() => page.locator(".landing-page").getAttribute("data-hero-in-view"), value => value === "true", "Visible hero enables decorative motion");
    const timing = await page.locator(heroSelector).evaluate(hero => hero.getAnimations({ subtree: true }).map(animation => animation.effect.getComputedTiming().endTime));
    assert.ok(timing.every(end => Number.isFinite(end) && end <= 5000), "Ambient hero movement has a finite duration of at most five seconds");
    const initial = (await motionState(page)).translate;
    await hoverHero(page);
    await until(() => motionState(page), value => Math.abs(value.x) > .05 && value.translate !== initial, "Pointer moves an existing hero card");
    assert.equal((await motionState(page)).overflow, false, "Pointer movement does not create page overflow");
    await page.screenshot({ path: path.join(artifacts, "landing-motion-hero.png") });
    await page.mouse.move(1, 1);
    await until(() => motionState(page), value => value.x === 0 && value.y === 0, "Leaving hero resets pointer offsets");
    await until(() => page.locator(heroSelector).evaluate(hero => hero.getAnimations({ subtree: true }).filter(animation => animation.playState === "running" || animation.pending).length), value => value === 0, "Finite hero motion settles", 6000);
    const settledOffsets = (await motionState(page)).translate.match(/-?[\d.]+/g) || ["0"];
    assert.ok(settledOffsets.every(value => Math.abs(Number(value)) < .1), "Leaving the hero returns the actual card translation to rest");
    const target = page.locator(revealSelector).first();
    assert.ok(await target.count(), "An existing below-fold section is progressively animated");
    const before = await target.evaluate(element => window.__landingMotionTest.filter(entry => entry.target === element).length);
    await target.evaluate(element => element.scrollIntoView({ block: "center", behavior: "instant" }));
    await until(() => target.evaluate(element => window.__landingMotionTest.filter(entry => entry.target === element).map(entry => ({ state: entry.animation.playState, frames: entry.animation.effect.getKeyframes().map(frame => ({ opacity: frame.opacity, transform: frame.transform })) }))), entries => entries.length > before && entries.some(entry => entry.frames.some(frame => frame.transform && frame.transform !== "none") && entry.frames.some(frame => Number(frame.opacity) < 1)), "Scrolling starts real transform-and-opacity reveal animation");
    await until(() => page.locator(".landing-page").getAttribute("data-hero-in-view"), value => value !== "true", "Offscreen hero stops its decorative motion");
    await until(() => motionState(page), value => value.hidden === 0 && value.active === 0, "Scrolled section settles into readable content");
    assert.equal((await motionState(page)).overflow, false, "Scrolled content has no page overflow");
    assert.match(await page.locator('.demo-step-nav [aria-current="step"]').innerText(), /Source$/, "Animation never advances the synthetic workflow");
    await page.screenshot({ path: path.join(artifacts, "landing-motion-section.png") });
  });
  pass("existing hero responds to the pointer, below-fold content reveals on scroll and finite motion settles without advancing the example");

  await scenario("landing-motion-reduced", { reducedMotion: "reduce", viewport: { width: 390, height: 844 } }, async page => {
    await page.goto(base + "/", { waitUntil: "networkidle" });
    await page.getByRole("heading", { level: 1 }).waitFor({ state: "visible" });
    await paint(page);
    assertResting(await motionState(page), "Initial reduced-motion preference");
    const link = page.locator(".landing-hero-actions").first().getByRole("link", { name: "Try it out", exact: true });
    await link.focus();
    await page.keyboard.press("Enter");
    await until(() => new URL(page.url()).hash, value => value === "#example", "Phone keyboard CTA reaches the example");
    const demo = page.getByLabel("Interactive synthetic product example", { exact: true });
    await demo.waitFor({ state: "visible" });
    assert.match(await demo.locator('[aria-current="step"]').innerText(), /Source$/);
    await demo.getByRole("button", { name: "Next: Intelligence", exact: true }).focus();
    await page.keyboard.press("Enter");
    await demo.getByRole("heading", { name: "Open the reason. See the source.", exact: true }).waitFor({ state: "visible" });
    await paint(page);
    assertResting(await motionState(page), "Reduced-motion keyboard interaction");
    await page.screenshot({ path: path.join(artifacts, "landing-motion-reduced-mobile.png") });
  });
  pass("initial reduced-motion preference keeps all content readable and the phone walkthrough works by keyboard without motion");

  await scenario("landing-motion-live-preference", {}, async page => {
    await page.goto(base + "/", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 1 }).waitFor({ state: "visible" });
    await until(() => motionState(page), value => value.enabled && value.active > 0, "Normal page has active motion before preference changes");
    await hoverHero(page);
    await until(() => motionState(page), value => Math.abs(value.x) > .05, "Pointer offset is active before preference change");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await until(() => motionState(page), value => !value.enabled && value.active === 0 && value.x === 0 && value.y === 0, "Live preference change stops active motion and resets pointer offsets");
    assertResting(await motionState(page), "Live reduced-motion preference");
    const demo = await keyboardExample(page);
    await paint(page);
    assert.match(await demo.locator('[aria-current="step"]').innerText(), /Source$/, "Live preference change preserves the selected step");
    assertResting(await motionState(page), "Reduced motion after keyboard navigation");
    await page.screenshot({ path: path.join(artifacts, "landing-motion-live-reduced.png") });
  });
  pass("changing the motion preference live cancels active animation and pointer offsets while preserving the keyboard CTA and source step");

  for (const fallback of ["observer-unavailable", "animation-rejected"]) {
    await scenario("landing-motion-" + fallback, {}, async page => {
      await page.addInitScript(mode => {
        if (mode === "observer-unavailable") {
          Object.defineProperty(window, "IntersectionObserver", { configurable: true, value: undefined });
        } else {
          Element.prototype.animate = function () { throw new Error("Synthetic browser animation failure"); };
        }
      }, fallback);
      await page.goto(base + "/", { waitUntil: "networkidle" });
      await page.getByRole("heading", { level: 1 }).waitFor({ state: "visible" });
      await keyboardExample(page);
      const faq = page.locator(".landing-faq-list details").first();
      await faq.locator("summary").focus();
      await page.keyboard.press("Enter");
      await until(() => faq.evaluate(element => element.open), value => value === true, fallback + ": native FAQ opens by keyboard");
      assert.ok(await faq.locator("p").isVisible(), fallback + ": FAQ answer remains readable");
      const target = page.locator(revealSelector).first();
      await target.scrollIntoViewIfNeeded();
      await until(() => motionState(page), value => value.hidden === 0, fallback + ": below-fold content remains readable");
      assert.equal((await motionState(page)).overflow, false, fallback + ": no page overflow");
      assert.match(await page.locator('.demo-step-nav [aria-current="step"]').innerText(), /Source$/, fallback + ": no automatic example progression");
    });
  }
  pass("missing intersection support or rejected Web Animations leave the page, in-page CTA and native FAQ usable without uncaught errors");
}
