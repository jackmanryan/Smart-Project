// ==UserScript==
// @name         Hamilton The Hamster (and Lizard)
// @namespace    jack.loading.overlay
// @version      1.4.0
// @description  Blocks with #EAE8F2 from document-start, bridges cross-document nav only; auto-cancels for SPA mutations. Random hamster/lizard loader.
// @match        https://extranet.strip-curtains.com/*
// @run-at       document-start
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_saveTab
// @grant        GM_getTab
// @noframes
// ==/UserScript==

(function () {
    "use strict";

    /*** CONFIG ***/
    /*** FORCE-SHOW ROUTE MATCHER ***/
    function isAutoSearchRoute() {
        try {
            const u = new URL(location.href);
            return u.searchParams.get('p') === 'search' && /^#?autosearch=/.test(u.hash);
        } catch { return false; }
    }
    let FORCE_MODE = isAutoSearchRoute();

    const EXTRA_IDLE_WAIT_MS = 700;   // after window 'load' to cover other @document-idle scripts
    const FADE_MS = 200;              // fade-out duration
    const BACKDROP_COLOR = "#EAE8F2"; // overlay color

    // Bridge heuristics
    const ARM_DELAY_MS = 80;          // wait a beat to see if SPA intercepts before showing
    const CONFIRM_DEADLINE_MS = 300;  // if no unload confirmation by then, cancel overlay
    const ENABLE_BRIDGE = !('SCTurbo' in window);    // set false to disable outgoing bridge entirely

    // -----------------------------------------------------
    // ANIMATION THEMES
    // -----------------------------------------------------

    // HAMSTER THEME
    const HAMSTER_CSS = `
/* Hamster wheel (scoped inside shadow DOM) */
.wheel-and-hamster { --dur: 1s; position: relative; width: 12em; height: 12em; font-size: 14px; }
.wheel, .hamster, .hamster div, .spoke { position: absolute; }
.wheel, .spoke { border-radius: 50%; top: 0; left: 0; width: 100%; height: 100%; }
.wheel {
  background: radial-gradient(100% 100% at center,hsla(0,0%,60%,0) 47.8%,hsl(0,0%,60%) 48%);
  z-index: 2;
}
.hamster {
  animation: hamster var(--dur) ease-in-out infinite;
  top: 50%;
  left: calc(50% - 3.5em);
  width: 7em;
  height: 3.75em;
  transform: rotate(4deg) translate(-0.8em,1.85em);
  transform-origin: 50% 0;
  z-index: 1;
}
.hamster__head {
  animation: hamsterHead var(--dur) ease-in-out infinite;
  background: hsl(30,90%,55%);
  border-radius: 70% 30% 0 100% / 40% 25% 25% 60%;
  box-shadow:
    0 -0.25em 0 hsl(30,90%,80%) inset,
    0.75em -1.55em 0 hsl(30,90%,90%) inset;
  top: 0;
  left: -2em;
  width: 2.75em;
  height: 2.5em;
  transform-origin: 100% 50%;
}
.hamster__ear {
  animation: hamsterEar var(--dur) ease-in-out infinite;
  background: hsl(0,90%,85%);
  border-radius: 50%;
  box-shadow: -0.25em 0 hsl(30,90%,55%) inset;
  top: -0.25em;
  right: -0.25em;
  width: 0.75em;
  height: 0.75em;
  transform-origin: 50% 75%;
}
.hamster__eye {
  animation: hamsterEye var(--dur) linear infinite;
  background-color: hsl(0,0%,0%);
  border-radius: 50%;
  top: 0.375em;
  left: 1.25em;
  width: 0.5em;
  height: 0.5em;
}
.hamster__nose {
  background: hsl(0,90%,75%);
  border-radius: 35% 65% 85% 15% / 70% 50% 50% 30%;
  top: 0.75em;
  left: 0;
  width: 0.2em;
  height: 0.25em;
}
.hamster__body {
  animation: hamsterBody var(--dur) ease-in-out infinite;
  background: hsl(30,90%,90%);
  border-radius: 50% 30% 50% 30% / 15% 60% 40% 40%;
  box-shadow:
    0.1em 0.75em 0 hsl(30,90%,55%) inset,
    0.15em -0.5em 0 hsl(30,90%,80%) inset;
  top: 0.25em;
  left: 2em;
  width: 4.5em;
  height: 3em;
  transform-origin: 17% 50%;
  transform-style: preserve-3d;
}
.hamster__limb--fr,
.hamster__limb--fl {
  clip-path: polygon(0 0,100% 0,70% 80%,60% 100%,0% 100%,40% 80%);
  top: 2em;
  left: 0.5em;
  width: 1em;
  height: 1.5em;
  transform-origin: 50% 0;
}
.hamster__limb--fr {
  animation: hamsterFRLimb var(--dur) linear infinite;
  background: linear-gradient(hsl(30,90%,80%) 80%,hsl(0,90%,75%) 80%);
  transform: rotate(15deg) translateZ(-1px);
}
.hamster__limb--fl {
  animation: hamsterFLLimb var(--dur) linear infinite;
  background: linear-gradient(hsl(30,90%,90%) 80%,hsl(0,90%,85%) 80%);
  transform: rotate(15deg);
}
.hamster__limb--br,
.hamster__limb--bl {
  border-radius: 0.75em 0.75em 0 0;
  clip-path: polygon(0 0,100% 0,100% 30%,70% 90%,70% 100%,30% 100%,40% 90%,0% 30%);
  top: 1em;
  left: 2.8em;
  width: 1.5em;
  height: 2.5em;
  transform-origin: 50% 30%;
}
.hamster__limb--br {
  animation: hamsterBRLimb var(--dur) linear infinite;
  background: linear-gradient(hsl(30,90%,80%) 90%,hsl(0,90%,75%) 90%);
  transform: rotate(-25deg) translateZ(-1px);
}
.hamster__limb--bl {
  animation: hamsterBLLimb var(--dur) linear infinite;
  background: linear-gradient(hsl(30,90%,90%) 90%,hsl(0,90%,85%) 90%);
  transform: rotate(-25deg);
}
.hamster__tail {
  animation: hamsterTail var(--dur) linear infinite;
  background: hsl(0,90%,85%);
  border-radius: 0.25em 50% 50% 0.25em;
  box-shadow: 0 -0.2em 0 hsl(0,90%,75%) inset;
  top: 1.5em;
  right: -0.5em;
  width: 1em;
  height: 0.5em;
  transform: rotate(30deg) translateZ(-1px);
  transform-origin: 0.25em 0.25em;
}
.spoke {
  animation: spoke var(--dur) linear infinite;
  background:
    radial-gradient(100% 100% at center,hsl(0,0%,60%) 4.8%,hsla(0,0%,60%,0) 5%),
    linear-gradient(
      hsla(0,0%,55%,0) 46.9%,
      hsl(0,0%,65%) 47% 52.9%,
      hsla(0,0%,65%,0) 53%
    )
    50% 50% / 99% 99% no-repeat;
}

/* Animations */
@keyframes hamster {
  from,to { transform: rotate(4deg) translate(-0.8em,1.85em); }
  50%     { transform: rotate(0) translate(-0.8em,1.85em); }
}
@keyframes hamsterHead {
  from,25%,50%,75%,to { transform: rotate(0); }
  12.5%,37.5%,62.5%,87.5% { transform: rotate(8deg); }
}
@keyframes hamsterEye {
  from,90%,to { transform: scaleY(1); }
  95%         { transform: scaleY(0); }
}
@keyframes hamsterEar {
  from,25%,50%,75%,to { transform: rotate(0); }
  12.5%,37.5%,62.5%,87.5% { transform: rotate(12deg); }
}
@keyframes hamsterBody {
  from,25%,50%,75%,to { transform: rotate(0); }
  12.5%,37.5%,62.5%,87.5% { transform: rotate(-2deg); }
}
@keyframes hamsterFRLimb {
  from,25%,50%,75%,to { transform: rotate(50deg) translateZ(-1px); }
  12.5%,37.5%,62.5%,87.5% { transform: rotate(-30deg) translateZ(-1px); }
}
@keyframes hamsterFLLimb {
  from,25%,50%,75%,to { transform: rotate(-30deg); }
  12.5%,37.5%,62.5%,87.5% { transform: rotate(50deg); }
}
@keyframes hamsterBRLimb {
  from,25%,50%,75%,to { transform: rotate(-60deg) translateZ(-1px); }
  12.5%,37.5%,62.5%,87.5% { transform: rotate(20deg) translateZ(-1px); }
}
@keyframes hamsterBLLimb {
  from,25%,50%,75%,to { transform: rotate(20deg); }
  12.5%,37.5%,62.5%,87.5% { transform: rotate(-60deg); }
}
@keyframes hamsterTail {
  from,25%,50%,75%,to { transform: rotate(30deg) translateZ(-1px); }
  12.5%,37.5%,62.5%,87.5% { transform: rotate(10deg) translateZ(-1px); }
}
@keyframes spoke {
  from { transform: rotate(0); }
  to   { transform: rotate(-1turn); }
}
`;

    const HAMSTER_HTML = `
<div aria-label="Orange and tan hamster running in a metal wheel" role="img" class="wheel-and-hamster">
  <div class="wheel"></div>
  <div class="hamster">
    <div class="hamster__body">
      <div class="hamster__head">
        <div class="hamster__ear"></div>
        <div class="hamster__eye"></div>
        <div class="hamster__nose"></div>
      </div>
      <div class="hamster__limb hamster__limb--fr"></div>
      <div class="hamster__limb hamster__limb--fl"></div>
      <div class="hamster__limb hamster__limb--br"></div>
      <div class="hamster__limb hamster__limb--bl"></div>
      <div class="hamster__tail"></div>
    </div>
  </div>
  <div class="spoke"></div>
</div>
`;

    // LIZARD THEME
    const LIZARD_CSS = `
/* =========================================================
   LIZARD LOADER
   ========================================================= */
.lizard-loader {
  --dur: 1s;
  --body-hue: 110;
  --belly-hue: 70;
  --eye-hue: 60;

  position: relative;
  width: 12em;
  height: 12em;
  font-size: 14px;
  color-scheme: light;
}

/* RING + SPOKES  (reverted to hamster wheel style) */
.lizard-loader__ring,
.lizard-loader__spokes {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  box-sizing: border-box;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

/* outer wheel rim */
.lizard-loader__ring {
  background: radial-gradient(
    100% 100% at center,
    hsla(0,0%,60%,0) 47.8%,
    hsl(0,0%,60%) 48%
  );
  z-index: 2;
}

/* inner rotating spokes */
.lizard-loader__spokes {
  animation: spoke var(--dur) linear infinite;
  background:
    radial-gradient(
      100% 100% at center,
      hsl(0,0%,60%) 4.8%,
      hsla(0,0%,60%,0) 5%
    ),
    linear-gradient(
      hsla(0,0%,55%,0) 46.9%,
      hsl(0,0%,65%) 47% 52.9%,
      hsla(0,0%,65%,0) 53%
    )
    50% 50% / 99% 99% no-repeat;
  border-radius: 50%;
  filter: none;
  z-index: 1;
}

/* LIZARD GROUP */
.lizard-loader__lizard,
.lizard-loader__lizard * {
  position: absolute;
}
.lizard-loader__lizard {
  top: 50%;
  left: calc(50% - 3.5em);
  width: 7em;
  height: 3.75em;
  transform-origin: 50% 0;
  transform: rotate(6deg) translate(-0.8em, 1.85em);
  animation: liz-bob var(--dur) ease-in-out infinite;
  will-change: transform;
  z-index: 3;
}

/* BODY / TORSO */
.lizard-loader__body {
  top: 0.5em;
  left: 2em;
  width: 4.5em;
  height: 2.75em;
  transform-origin: 15% 50%;
  transform-style: preserve-3d;
  border-radius: 60% 35% 45% 35% / 45% 55% 45% 45%;
  background:
    radial-gradient(
      ellipse at 30% 70%,
      hsl(calc(var(--belly-hue) + 5),60%,80%) 0%,
      hsl(var(--belly-hue),50%,70%) 40%,
      hsla(var(--belly-hue),50%,70%,0) 41%
    ),
    radial-gradient(circle at 35% 35%, hsla(var(--body-hue),50%,20%,0.6) 0 20%, transparent 21%),
    radial-gradient(circle at 55% 30%, hsla(var(--body-hue),50%,20%,0.6) 0 22%, transparent 23%),
    radial-gradient(circle at 75% 40%, hsla(var(--body-hue),50%,20%,0.6) 0 20%, transparent 21%),
    linear-gradient(
      to bottom right,
      hsl(var(--body-hue),45%,38%) 0%,
      hsl(var(--body-hue),45%,30%) 60%
    );
  box-shadow:
    0.15em 0.5em 0 hsl(var(--body-hue),45%,22%) inset,
    -0.1em -0.4em 0 hsl(var(--body-hue),45%,45%) inset;
  animation: liz-bodyMotion var(--dur) ease-in-out infinite;
}

/* fine scale texture */
.lizard-loader__body::after {
  content: "";
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  mix-blend-mode: screen;
  opacity: 0.22;
  background:
    repeating-radial-gradient(
      circle at 0 0,
      hsla(var(--body-hue),40%,60%,0.4) 0 0.08em,
      hsla(var(--body-hue),40%,60%,0) 0.09em 0.3em
    );
  background-size: 0.4em 0.4em;
}

/* DORSAL SPIKES */
.lizard-loader__spikes {
  left: 0.5em;
  top: -0.9em;
  width: 3.4em;
  height: 1.4em;
  background:
    repeating-linear-gradient(
      -65deg,
      hsl(var(--body-hue),60%,55%) 0 0.5em,
      hsla(var(--body-hue),60%,55%,0) 0.5em 0.7em
    );
  clip-path: polygon(0 100%, 100% 100%, 100% 0);
  border-radius: 0.2em;
  transform-origin: 0% 100%;
  transform: skewX(-12deg);
  filter:
    drop-shadow(0 0.05em 0 hsl(var(--body-hue),45%,20%))
    drop-shadow(0 0.15em 0 hsla(0,0%,0%,0.35));
  z-index: 4;
  animation: liz-spikesWobble calc(var(--dur)*1.2) ease-in-out infinite;
  animation-delay: calc(var(--dur) * -0.3);
}

/* HEAD */
.lizard-loader__head {
  top: 0.4em;
  left: -2em;
  width: 2.6em;
  height: 2em;
  transform-origin: 100% 50%;
  border-radius: 60% 40% 45% 70% / 55% 40% 50% 60%;
  background:
    radial-gradient(
      circle at 20% 60%,
      hsl(calc(var(--body-hue) - 15),60%,60%) 0%,
      hsla(calc(var(--body-hue) - 15),60%,60%,0) 60%
    ),
    linear-gradient(
      to bottom right,
      hsl(var(--body-hue),45%,38%) 0%,
      hsl(var(--body-hue),45%,28%) 70%
    );
  box-shadow:
    0 0.4em 0.4em hsla(var(--body-hue),45%,15%,0.4) inset,
    0 -0.25em 0 hsl(var(--body-hue),45%,50%) inset;
  animation: liz-headBob var(--dur) ease-in-out infinite;
  z-index: 5;
}

/* cranial crest */
.lizard-loader__head::before {
  content: "";
  top: -0.45em;
  left: 1em;
  width: 1.4em;
  height: 0.8em;
  background:
    radial-gradient(
      circle at 30% 30%,
      hsl(var(--body-hue),45%,40%) 0%,
      hsl(var(--body-hue),45%,25%) 70%
    );
  border-radius: 60% 40% 60% 40%;
  box-shadow:
    0.15em 0.15em 0 hsl(var(--body-hue),45%,20%) inset,
    0 -0.1em 0 hsl(var(--body-hue),45%,50%) inset;
  transform-origin: 0% 100%;
  transform: rotate(-15deg) skewX(-10deg);
  filter: drop-shadow(0 0.08em 0.08em hsla(0,0%,0%,0.4));
  animation: liz-crestWobble calc(var(--dur)*1.2) ease-in-out infinite;
  animation-delay: calc(var(--dur)*-0.15);
}

/* throat dewlap */
.lizard-loader__head::after {
  content: "";
  left: 0.3em;
  top: 1.3em;
  width: 1.2em;
  height: 0.8em;
  background:
    radial-gradient(
      ellipse at 50% 30%,
      hsl(calc(var(--belly-hue) + 10),70%,75%) 0%,
      hsl(var(--belly-hue),50%,55%) 60%,
      hsla(var(--belly-hue),50%,55%,0) 61%
    );
  border-radius: 60% 60% 70% 70%;
  box-shadow:
    0 0.25em 0.3em hsla(var(--body-hue),45%,10%,0.4) inset,
    0 -0.15em 0 hsl(var(--belly-hue),60%,80%) inset;
  transform-origin: 20% 0%;
  animation: liz-dewlapJiggle var(--dur) ease-in-out infinite;
  z-index: -1;
}

/* EYE */
.lizard-loader__eye {
  top: 0.5em;
  left: 1.2em;
  width: 0.6em;
  height: 0.6em;
  border-radius: 50%;
  background:
    radial-gradient(
      circle at 50% 50%,
      hsl(0,0%,0%) 0 40%,
      transparent 41%
    );
  box-shadow:
    0 0 0 0.18em hsl(var(--eye-hue),90%,55%) inset,
    0 0 0.25em hsla(0,0%,0%,0.6);
  animation: liz-eyeBlink var(--dur) linear infinite;
}

/* TONGUE */
.lizard-loader__tongue {
  top: 1.15em;
  left: -0.5em;
  width: 1em;
  height: 0.25em;
  border-radius: 0.25em;
  background:
    radial-gradient(circle at 10% 50%, hsl(5,90%,70%) 0%, hsl(5,80%,55%) 60%);
  box-shadow:
    0 0 0.1em hsla(0,0%,0%,0.4),
    0 0.15em 0.15em hsla(5,80%,30%,0.4) inset;
  transform-origin: 100% 50%;
  transform: scaleX(0) rotate(0deg);
  animation: liz-tongueFlick calc(var(--dur)*1.5) cubic-bezier(.3,.7,.4,1) infinite;
  z-index: 10;
}
.lizard-loader__tongue::after {
  content: "";
  right: -0.3em;
  top: 0.05em;
  width: 0.4em;
  height: 0.15em;
  background: hsl(5,80%,60%);
  border-radius: 0.05em 0.05em 0.1em 0.1em;
  box-shadow: 0 0 0.1em hsla(0,0%,0%,0.4);
  clip-path: polygon(
    0 50%,
    40% 0,
    100% 40%,
    60% 50%,
    100% 60%,
    40% 100%
  );
  transform-origin: 0% 50%;
}

/* LEGS */
.lizard-loader__leg {
  top: 1.4em;
  left: 0.5em;
  width: 1em;
  height: 1.5em;
  transform-origin: 50% 0;
  border-radius: 0.5em 0.5em 0 0;
  clip-path: polygon(
    0 0,
    100% 0,
    80% 70%,
    60% 100%,
    40% 100%,
    20% 70%
  );
  background:
    linear-gradient(
      hsl(var(--body-hue),45%,32%) 70%,
      hsl(var(--belly-hue),60%,75%) 70%
    );
  box-shadow:
    0 -0.25em 0 hsl(var(--body-hue),45%,22%) inset,
    0 0.25em 0 hsl(var(--body-hue),45%,50%) inset;
}
.lizard-loader__leg--fr {
  top: 1.55em;
  left: 0.4em;
  transform: rotate(40deg) translateZ(-1px);
  animation: liz-legFR var(--dur) linear infinite;
  z-index: 4;
}
.lizard-loader__leg--fl {
  top: 1.55em;
  left: 0.6em;
  transform: rotate(-30deg);
  animation: liz-legFL var(--dur) linear infinite;
  background:
    linear-gradient(
      hsl(var(--body-hue),45%,28%) 70%,
      hsl(var(--belly-hue),60%,75%) 70%
    );
  z-index: 2;
}
.lizard-loader__leg--br,
.lizard-loader__leg--bl {
  top: 0.9em;
  left: 2.9em;
  width: 1.4em;
  height: 2em;
  transform-origin: 50% 20%;
  border-radius: 0.75em 0.75em 0 0;
  clip-path: polygon(
    0 0,
    100% 0,
    100% 30%,
    80% 70%,
    70% 100%,
    30% 100%,
    20% 70%,
    0 30%
  );
  background:
    linear-gradient(
      hsl(var(--body-hue),45%,32%) 80%,
      hsl(var(--belly-hue),60%,75%) 80%
    );
}
.lizard-loader__leg--br {
  transform: rotate(-50deg) translateZ(-1px);
  animation: liz-legBR var(--dur) linear infinite;
  z-index: 1;
}
.lizard-loader__leg--bl {
  transform: rotate(20deg);
  animation: liz-legBL var(--dur) linear infinite;
  z-index: 0;
}

/* TAIL */
.lizard-loader__tail {
  top: 1.35em;
  right: -1.6em;
  width: 2.2em;
  height: 0.8em;
  transform-origin: 0.4em 0.4em;
  transform: rotate(30deg) translateZ(-1px);
  border-radius: 0.4em 80% 70% 0.4em;
  background:
    radial-gradient(
      circle at 25% 40%,
      hsl(var(--body-hue),45%,50%) 0%,
      hsla(var(--body-hue),45%,50%,0) 70%
    ),
    repeating-linear-gradient(
      to right,
      hsla(var(--body-hue),45%,15%,0.8) 0 0.4em,
      hsla(var(--body-hue),45%,15%,0) 0.4em 0.8em
    ),
    linear-gradient(
      to bottom right,
      hsl(var(--body-hue),45%,35%) 0%,
      hsl(var(--body-hue),45%,22%) 70%
    );
  box-shadow: 0 -0.2em 0 hsl(var(--body-hue),45%,20%) inset;
  animation: liz-tailWhip var(--dur) linear infinite;
  z-index: 1;
}
.lizard-loader__tail::after {
  content: "";
  left: 1.6em;
  top: 0.15em;
  width: 1.2em;
  height: 0.8em;
  border-radius: 70% 70% 70% 70%;
  transform-origin: 0.4em 0.4em;
  transform: rotate(40deg);
  background:
    radial-gradient(
      circle at 30% 40%,
      hsl(var(--body-hue),45%,50%) 0%,
      hsla(var(--body-hue),45%,50%,0) 70%
    ),
    repeating-linear-gradient(
      to right,
      hsla(var(--body-hue),45%,15%,0.8) 0 0.4em,
      hsla(var(--body-hue),45%,15%,0) 0.4em 0.8em
    ),
    linear-gradient(
      to bottom right,
      hsl(var(--body-hue),45%,35%) 0%,
      hsl(var(--body-hue),45%,22%) 70%
    );
  box-shadow: 0 -0.2em 0 hsl(var(--body-hue),45%,20%) inset;
}

/* =========================================================
   ANIMATIONS
   ========================================================= */

/* old wheel rotation */
@keyframes spoke {
  from { transform: rotate(0); }
  to   { transform: rotate(-1turn); }
}

@keyframes liz-bob {
  0%,100% {
    transform: rotate(6deg) translate(-0.8em, 1.85em);
  }
  50% {
    transform: rotate(0deg) translate(-0.8em, 1.85em);
  }
}

@keyframes liz-bodyMotion {
  0%,25%,50%,75%,100% {
    transform: rotate(0deg) translateY(0) scaleX(1) scaleY(1);
  }
  12.5%,37.5%,62.5%,87.5% {
    transform: rotate(-3deg) translateY(0.05em) scaleX(1.02) scaleY(0.98);
  }
}
@keyframes liz-headBob {
  0%,25%,50%,75%,100% {
    transform: rotate(0deg) translateY(0);
  }
  12.5%,37.5%,62.5%,87.5% {
    transform: rotate(8deg) translateY(0.03em);
  }
}
@keyframes liz-eyeBlink {
  0%,90%,100% { transform: scaleY(1); }
  95%         { transform: scaleY(0); }
}
@keyframes liz-tongueFlick {
  0%,60%,100% {
    transform: scaleX(0) rotate(0deg);
  }
  8% {
    transform: scaleX(1.15) rotate(-10deg);
  }
  14% {
    transform: scaleX(0.9) rotate(8deg);
  }
  20% {
    transform: scaleX(0) rotate(0deg);
  }
}
@keyframes liz-dewlapJiggle {
  0%,25%,50%,75%,100% {
    transform: scaleY(1) scaleX(1) rotate(0deg);
  }
  12.5%,37.5%,62.5%,87.5% {
    transform: scaleY(1.15) scaleX(0.95) rotate(2deg);
  }
}
@keyframes liz-spikesWobble {
  0%,25%,50%,75%,100% {
    transform: skewX(-12deg) rotate(0deg) translateY(0);
  }
  12.5%,62.5% {
    transform: skewX(-8deg) rotate(-3deg) translateY(0.05em);
  }
  37.5%,87.5% {
    transform: skewX(-16deg) rotate(2deg) translateY(-0.03em);
  }
}
@keyframes liz-crestWobble {
  0%,25%,50%,75%,100% {
    transform: rotate(-15deg) skewX(-10deg) translateY(0);
  }
  12.5%,37.5%,62.5%,87.5% {
    transform: rotate(-10deg) skewX(-8deg) translateY(0.05em);
  }
}
@keyframes liz-legFR {
  0%,25%,50%,75%,100% {
    transform: rotate(40deg) translateZ(-1px);
  }
  12.5%,37.5%,62.5%,87.5% {
    transform: rotate(-30deg) translateZ(-1px);
  }
}
@keyframes liz-legFL {
  0%,25%,50%,75%,100% {
    transform: rotate(-30deg);
  }
  12.5%,37.5%,62.5%,87.5% {
    transform: rotate(40deg);
  }
}
@keyframes liz-legBR {
  0%,25%,50%,75%,100% {
    transform: rotate(-50deg) translateZ(-1px);
  }
  12.5%,37.5%,62.5%,87.5% {
    transform: rotate(20deg) translateZ(-1px);
  }
}
@keyframes liz-legBL {
  0%,25%,50%,75%,100% {
    transform: rotate(20deg);
  }
  12.5%,37.5%,62.5%,87.5% {
    transform: rotate(-50deg);
  }
}
@keyframes liz-tailWhip {
  0%,50%,100% {
    transform: rotate(30deg) translateZ(-1px);
  }
  12.5%,62.5% {
    transform: rotate(5deg) translateZ(-1px);
  }
  25%,75% {
    transform: rotate(20deg) translateZ(-1px);
  }
}
`;

    const LIZARD_HTML = `
<div class="lizard-loader" role="img" aria-label="Green cartoon lizard sprinting inside a glowing ring">
  <div class="lizard-loader__ring"></div>
  <div class="lizard-loader__spokes"></div>

  <div class="lizard-loader__lizard">
    <div class="lizard-loader__body">
      <div class="lizard-loader__spikes"></div>

      <div class="lizard-loader__head">
        <div class="lizard-loader__eye"></div>
        <div class="lizard-loader__tongue"></div>
      </div>

      <div class="lizard-loader__leg lizard-loader__leg--fr"></div>
      <div class="lizard-loader__leg lizard-loader__leg--fl"></div>
      <div class="lizard-loader__leg lizard-loader__leg--br"></div>
      <div class="lizard-loader__leg lizard-loader__leg--bl"></div>

      <div class="lizard-loader__tail"></div>
    </div>
  </div>
</div>
`;

    // RANDOM PICK (50/50)
    const PICK = (Math.random() < 0.5)
    ? { css: HAMSTER_CSS, html: HAMSTER_HTML }
    : { css: LIZARD_CSS,  html: LIZARD_HTML  };

    /*** CROSS-PAGE HANDOFF ***/
    const HANDOFF_KEY = "TopLoaderHandoff";
    const NAME_PREFIX = "[TL]";
    const supports = {
        saveTab: typeof GM_saveTab === "function" || (typeof GM !== "undefined" && typeof GM.saveTab === "function"),
        getTab: typeof GM_getTab === "function" || (typeof GM !== "undefined" && typeof GM.getTab === "function"),
    };
    function saveTabData(obj){ try{ if (typeof GM?.saveTab==="function"){GM.saveTab(obj);return;} if (typeof GM_saveTab==="function"){GM_saveTab(obj);return;} }catch{} }
    async function getTabData(){ try{ if (typeof GM?.getTab==="function") return await GM.getTab(); if (typeof GM_getTab==="function") return await new Promise(res=>GM_getTab(res)); }catch{} return null; }
    function writeNameHandoff(payload){ try{ const cur=window.name||""; const sanitized=cur.replace(new RegExp("\\\\Q"+NAME_PREFIX+"\\\\E\\{.*\\}$"),""); window.name=sanitized+NAME_PREFIX+JSON.stringify(payload);}catch{} }
    function readNameHandoff(){ try{ const cur=window.name||""; const m=cur.match(new RegExp("\\\\Q"+NAME_PREFIX+"\\\\E(\\{.*\\})$")); if(m){ const payload=JSON.parse(m[1]); window.name=cur.replace(new RegExp("\\\\Q"+NAME_PREFIX+"\\\\E\\{.*\\}$"),""); return payload; } }catch{} return null; }

    function markHandoff(){ const payload={ t: Date.now(), color: BACKDROP_COLOR, fade: FADE_MS }; if (supports.saveTab) saveTabData({ [HANDOFF_KEY]: payload }); writeNameHandoff(payload); }

    /*** OVERLAY (top layer) ***/
    let active = true;
    const overlayHost = document.createElement("div");
    overlayHost.setAttribute("data-toploader","true");
    overlayHost.style.position="fixed"; overlayHost.style.inset="0";
    overlayHost.style.zIndex="2147483647"; overlayHost.style.pointerEvents="auto";
    overlayHost.style.contain="layout style paint"; overlayHost.style.display="block";

    const shadow = overlayHost.attachShadow({ mode:"open" });
    const baseStyle = document.createElement("style");
    baseStyle.textContent = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
#backdrop {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${BACKDROP_COLOR};
  opacity: 1;
  transition: opacity ${FADE_MS}ms ease;
  will-change: opacity;
}
#content {
  display: grid;
  place-items: center;
}
.hidden { opacity: 0; }
`;
    shadow.appendChild(baseStyle);

    const userStyle = document.createElement("style");
    userStyle.textContent = PICK.css || "";
    shadow.appendChild(userStyle);

    const backdrop = document.createElement("div");
    backdrop.id="backdrop";

    const content = document.createElement("div");
    content.id="content";
    content.innerHTML = PICK.html || "";

    backdrop.appendChild(content);
    shadow.appendChild(backdrop);

    const lockCSS = document.createElement("style");
    lockCSS.textContent = "html, body { overflow: hidden !important; }";
    (document.head || document.documentElement).appendChild(lockCSS);

    const supportsPopover = "showPopover" in HTMLElement.prototype;
    const supportsDialog = typeof window.HTMLDialogElement === "function";
    let usingPopover=false, usingDialog=false, dialogEl=null;

    function attachAndShowTopLayer(){
        if (supportsPopover) {
            overlayHost.setAttribute("popover","manual");
            document.documentElement.appendChild(overlayHost);
            overlayHost.showPopover?.();
            usingPopover=true;
        } else if (supportsDialog) {
            dialogEl=document.createElement("dialog");
            Object.assign(dialogEl.style,{
                padding:"0",margin:"0",border:"none",
                width:"100vw",height:"100vh",
                maxWidth:"100vw",maxHeight:"100vh"
            });
            dialogEl.appendChild(overlayHost);
            document.documentElement.appendChild(dialogEl);
            try{ dialogEl.showModal(); }catch{}
            usingDialog=true;
        } else {
            document.documentElement.appendChild(overlayHost);
        }
    }
    attachAndShowTopLayer();

    const originals = {};
    (function patchTopLayer(){
        if (supportsDialog) {
            const p = HTMLDialogElement.prototype;
            if (!originals.showModal && p.showModal) {
                originals.showModal = p.showModal;
                p.showModal = function(...args){
                    const r = originals.showModal.apply(this,args);
                    if (active) queueMicrotask(()=> usingPopover?overlayHost.showPopover?.():dialogEl?.showModal?.());
                    return r;
                };
            }
        }
        if (supportsPopover) {
            const p = HTMLElement.prototype;
            if (!originals.showPopover && p.showPopover) {
                originals.showPopover = p.showPopover;
                p.showPopover = function(...args){
                    const r = originals.showPopover.apply(this,args);
                    if (active) queueMicrotask(()=> overlayHost.showPopover?.());
                    return r;
                };
            }
        }
        document.addEventListener("fullscreenchange", () => {
            if (!active) return;
            if (usingPopover) overlayHost.showPopover?.();
            if (usingDialog) dialogEl?.showModal?.();
        }, true);
    })();

    // Public API
    window.TopLoader = {
        setContent(html="", css=""){
            content.innerHTML = html;
            if (css) userStyle.textContent = css;
        },
        show(){
            if (usingPopover){
                if (!overlayHost.isConnected) document.documentElement.appendChild(overlayHost);
                overlayHost.showPopover?.();
            } else if (usingDialog){
                if (!dialogEl?.isConnected) document.documentElement.appendChild(dialogEl);
                dialogEl?.showModal?.();
            } else {
                if (!overlayHost.isConnected) document.documentElement.appendChild(overlayHost);
            }
            backdrop.classList.remove("hidden");
            (document.head || document.documentElement).appendChild(lockCSS);
        },
        hide: hideOverlay,
        config: { EXTRA_IDLE_WAIT_MS, FADE_MS, BACKDROP_COLOR },
    };

    /*** INITIAL HIDE SEQUENCE ***/
    const waitForWindowLoad = new Promise((resolve) => {
        if (document.readyState === "complete") return resolve();
        window.addEventListener("load", () => resolve(), { once: true });
    });
    function afterIdleBuffer(ms){
        return new Promise((done)=>{
            const finish=()=>setTimeout(done,ms);
            if ("requestIdleCallback" in window)
                window.requestIdleCallback(finish,{timeout:ms});
            else finish();
        });
    }
    function nextTwoFrames(){
        return new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    }

    async function hideOverlay(){
        active = false;
        if (originals.showModal && supportsDialog) HTMLDialogElement.prototype.showModal = originals.showModal;
        if (originals.showPopover && supportsPopover) HTMLElement.prototype.showPopover = originals.showPopover;
        backdrop.classList.add("hidden");
        await new Promise((r)=>setTimeout(r, FADE_MS));
        if (usingDialog){
            try{ dialogEl?.close?.(); }catch{}
            dialogEl?.remove?.();
        }
        overlayHost.remove();
        lockCSS.remove();
    }

    (async () => {
        const forcedAtBoot = FORCE_MODE;
        const tabData = supports.getTab ? await getTabData() : null;
        const handoff = (tabData && tabData[HANDOFF_KEY]) || readNameHandoff();
        // 'handoff' reserved for possible phase sync between pages
        await waitForWindowLoad;
        await afterIdleBuffer(EXTRA_IDLE_WAIT_MS);
        await nextTwoFrames();
        if (!forcedAtBoot) {
            hideOverlay();
        } else {
            // We're on /?p=search#autosearch=*, keep overlay visible.
            active = true;
            window.TopLoader.show();
        }
        hideOverlay();
    })();

    /***** SMART BRIDGE (avoid SPA mutations) *****/
    if (ENABLE_BRIDGE) {
        /*** FORCE-MODE REEVALUATION (SPA/hash aware) ***/
        function reevaluateForceMode() {
            const next = isAutoSearchRoute();
            if (next === FORCE_MODE) return;
            FORCE_MODE = next;
            if (FORCE_MODE) {
                active = true;
                window.TopLoader.show();      // (re)assert overlay
            } else {
                window.TopLoader.hide?.();    // leave gracefully when exiting that page
            }
        }

        // Watch typical SPA signals + hash changes
        window.addEventListener("hashchange",   reevaluateForceMode, true);
        window.addEventListener("locationchange", reevaluateForceMode, true);
        window.addEventListener("popstate",     reevaluateForceMode, true);

        let pending = null;

        function isEligibleAnchor(ev){
            if (ev.defaultPrevented) return false;
            if (ev.button !== 0) return false;
            if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return false;
            let a = ev.target;
            while (a && a.nodeType === 1 && a.tagName !== "A") a = a.parentElement;
            if (!a || a.tagName !== "A") return false;
            const href = a.getAttribute("href");
            if (!href || href.startsWith("#")) return false;
            const target = (a.getAttribute("target") || "_self").toLowerCase();
            const download = a.hasAttribute("download");
            if (download) return false;
            return target === "_self";
        }

        function armAttempt(reason){
            cancelAttempt(); // only one at a time
            const stamp = Date.now();
            let showTimer = null, deadlineTimer = null;
            let shown = false, confirmed = false;

            // show after a tiny delay (gives SPA a chance to intercept)
            showTimer = setTimeout(() => {
                if (!confirmed) { window.TopLoader.show(); shown = true; }
            }, ARM_DELAY_MS);

            // deadline: if not confirmed by then, cancel
            deadlineTimer = setTimeout(() => {
                if (!confirmed) cancelAttempt();
            }, CONFIRM_DEADLINE_MS);

            pending = {
                stamp, reason, showTimer, deadlineTimer,
                get shown(){return shown;}, set shown(v){shown=v;},
                get confirmed(){return confirmed;}, set confirmed(v){confirmed=v;}
            };
        }

        function confirmAttempt(){
            if (!pending) return;
            pending.confirmed = true;
            clearTimeout(pending.showTimer);
            // ensure visible in case we haven't shown yet
            if (!pending.shown) {
                window.TopLoader.show();
                pending.shown = true;
            }
            markHandoff();
            clearTimeout(pending.deadlineTimer);
            // don't clear pending here; page will unload
        }

        function cancelAttempt(){
            if (!pending) return;
            clearTimeout(pending.showTimer);
            clearTimeout(pending.deadlineTimer);
            if (pending.shown) {
                // we showed but it was an SPA mutation => hide again
                window.TopLoader.hide?.();
                // Rebuild lockCSS so page can scroll after hide
                (document.head || document.documentElement).appendChild(lockCSS);
            }
            pending = null;
        }

        // Anchor clicks (potential cross-doc). Arm, but require confirmation.
        document.addEventListener("click", (ev) => {
            if (!isEligibleAnchor(ev)) return;
            armAttempt("anchor");
        }, true);

        // Form submits (same-tab) — skip if legacy wants new tab, or explicit _blank
        document.addEventListener("submit", (ev) => {
            const form = ev.target;
            const wantsNewTab = !!form.__tmxNewTabIntent;
            const target = (form.getAttribute("target") || "_self").toLowerCase();
            const submitterTarget = (ev.submitter?.getAttribute("formtarget") || ev.submitter?.getAttribute("target") || "").toLowerCase();

            if (wantsNewTab || target === "_blank" || submitterTarget === "_blank") return;
            if (target === "_self") armAttempt("form");
        }, true);

        // Programmatic navigations → confirm on unload/pagehide

        // BackBoost keeps BFCache by swallowing beforeunload; rely on pagehide instead.
        // window.addEventListener("beforeunload", confirmAttempt, { capture: true });
        window.addEventListener("pagehide",     confirmAttempt, { capture: true });

        window.addEventListener('pageshow', e => {
            if (e.persisted || (performance.getEntriesByType('navigation')[0]?.type === 'back_forward')) {
                try { window.TopLoader?.hide?.(); } catch {}
            }
        }, { once:true });
        window.addEventListener('sc:instant-back', () => {
            try { window.TopLoader?.hide?.(); } catch {}
        });

        // Navigation API (new): sameDocument = SPA; cross-document = confirm
        if ("navigation" in window && typeof window.navigation.addEventListener === "function") {
            window.navigation.addEventListener("navigate", (e) => {
                if (e.destination && e.destination.sameDocument) {
                    cancelAttempt();
                } else {
                    confirmAttempt();
                }
            });
        }

        // SPA signals → cancel
        (function patchHistory(){
            const hp = History.prototype;
            const _push = hp.pushState, _replace = hp.replaceState;
            hp.pushState = function(...args){
                const r=_push.apply(this,args);
                window.dispatchEvent(new Event("locationchange"));
                return r;
            };
            hp.replaceState = function(...args){
                const r=_replace.apply(this,args);
                window.dispatchEvent(new Event("locationchange"));
                return r;
            };
        })();

        window.addEventListener("locationchange", cancelAttempt, true);
        window.addEventListener("popstate",        cancelAttempt, true);
        window.addEventListener("hashchange",      cancelAttempt, true);

        // Visibility change: going hidden is a strong sign of real navigation
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "hidden") confirmAttempt();
        }, true);

        // Direct bridge events
        // detail: { state: 'start' | 'stop', source: 'legacy-form' }
        window.addEventListener("hamilton:loading", (e) => {
            const d = e?.detail || {};
            if (d.state === "start") {
                // Show immediately and mark handoff
                armAttempt("external");
                confirmAttempt();
            } else if (d.state === "stop") {
                // Page aborted without navigating → hide/cancel
                cancelAttempt();
            }
        }, true);
    }
})();
