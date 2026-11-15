import Link from "next/link";
import type { CSSProperties } from "react";

const steps = [
  { number: "01", title: "Explore a region", description: "Inspect lunar south-polar locations and the coordinates that identify them." },
  { number: "02", title: "Set the observation time", description: "Choose a date and UTC hour to define the mission scenario you want to examine." },
  { number: "03", title: "Compare the conditions", description: "Review different places and times, and understand the factors a mission team must evaluate." },
];

function MissionSchematic() {
  return (
    <div className="mission-visual" role="img" aria-label="Illustrative lunar mission planning diagram showing a south-polar site in relation to the Sun, Earth, terrain and observation time.">
      <div className="mission-visual-top">
        <span><i aria-hidden="true" /> LUNEX / MISSION CONTEXT</span>
        <span>FIELD VIEW 01</span>
      </div>
      <div className="mission-visual-heading">
        <div><span>THE LUNAR SOUTH POLE</span><h3>One location. Many mission factors.</h3></div>
        <span className="mission-visual-index">01 — 03</span>
      </div>
      <svg className="mission-schematic" viewBox="0 0 720 430" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="lunex-moon-fill" x1="360" y1="210" x2="360" y2="430" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFFFFF" stopOpacity=".2" /><stop offset="1" stopColor="#FFFFFF" stopOpacity=".035" />
          </linearGradient>
          <radialGradient id="lunex-earth-glow" cx="0" cy="0" r="1" gradientTransform="translate(552 112) rotate(90) scale(70)" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFFFFF" stopOpacity=".2" /><stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>
          <clipPath id="lunex-moon-clip"><circle cx="360" cy="432" r="205" /></clipPath>
        </defs>
        <g className="schematic-stars">
          <circle cx="76" cy="82" r="2.3" /><circle cx="200" cy="46" r="1.4" /><circle cx="310" cy="104" r="1.8" />
          <circle cx="440" cy="53" r="1.4" /><circle cx="640" cy="72" r="2" /><circle cx="674" cy="214" r="1.4" />
          <circle cx="106" cy="220" r="1.3" /><circle cx="237" cy="179" r="1.2" /><circle cx="596" cy="268" r="1.2" /><circle cx="493" cy="185" r="1.5" />
        </g>
        <path className="schematic-orbit schematic-orbit-white" d="M74 252C158 45 505 18 647 183C707 252 620 316 533 320" />
        <path className="schematic-orbit schematic-orbit-red" d="M112 290C159 117 443 46 592 174C650 225 600 282 538 306" />
        <path className="schematic-orbit-dash" d="M104 168C220 25 490 25 622 148" />
        <g className="schematic-sun" transform="translate(142 130)">
          <circle r="32" fill="#FC3D21" fillOpacity=".08" stroke="#FC3D21" strokeOpacity=".75" />
          <circle r="15" fill="#FC3D21" />
          <path d="M0 -26V-40M0 26V40M-26 0H-40M26 0H40M-18.4 -18.4L-28 -28M18.4 18.4L28 28M18.4 -18.4L28 -28M-18.4 18.4L-28 28" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" />
        </g>
        <text x="142" y="190" textAnchor="middle" className="schematic-label">SUNLIGHT</text>
        <g className="schematic-earth" transform="translate(552 112)">
          <circle r="68" fill="url(#lunex-earth-glow)" />
          <circle r="39" fill="#0B3D91" stroke="#FFFFFF" strokeOpacity=".9" strokeWidth="1.5" />
          <path d="M-23 -11L-11 -28L2 -24L7 -12L20 -9L25 5L13 12L7 27L-9 25L-17 10L-28 4L-23 -11Z" fill="#FFFFFF" fillOpacity=".72" />
          <path d="M-31 -22C-15 -43 15 -48 33 -32M-35 17C-19 38 13 47 35 28" stroke="#FFFFFF" strokeOpacity=".55" strokeWidth="1" />
          <circle r="50" stroke="#FFFFFF" strokeOpacity=".2" strokeDasharray="2 7" />
        </g>
        <text x="552" y="173" textAnchor="middle" className="schematic-label">EARTH VIEW</text>
        <g clipPath="url(#lunex-moon-clip)">
          <circle cx="360" cy="432" r="205" fill="url(#lunex-moon-fill)" stroke="#FFFFFF" strokeOpacity=".88" strokeWidth="1.5" />
          <path d="M143 350L182 335L216 345L250 313L287 329L319 300L354 316L388 291L425 309L461 295L500 321L536 309L574 338" stroke="#FFFFFF" strokeOpacity=".34" strokeWidth="1.3" />
          <path d="M142 366L180 351L216 362L251 331L287 345L319 320L354 333L388 310L425 326L461 312L500 337L536 327L575 353V500H142V366Z" fill="#FFFFFF" fillOpacity=".09" />
          <path d="M145 366L183 351L218 362L252 331L288 345L320 320L354 333L389 310L425 326L461 312L500 337L536 327L575 353" stroke="#FFFFFF" strokeOpacity=".76" strokeWidth="1.7" />
          <path d="M210 391C274 366 434 364 510 394" stroke="#FC3D21" strokeOpacity=".8" strokeWidth="1.2" strokeDasharray="4 7" />
          <path d="M277 356L302 341L323 348L343 331M412 365L431 349L452 355L475 339" stroke="#FFFFFF" strokeOpacity=".3" strokeWidth="1" />
        </g>
        <path d="M360 270V309" stroke="#FC3D21" strokeWidth="1.4" strokeDasharray="3 5" />
        <circle cx="360" cy="315" r="7" fill="#FC3D21" stroke="#FFFFFF" strokeWidth="2" className="schematic-site-pulse" />
        <circle cx="360" cy="315" r="18" stroke="#FC3D21" strokeOpacity=".7" className="schematic-site-ring" />
        <path d="M371 309L414 286H488" stroke="#FC3D21" strokeWidth="1.2" />
        <text x="420" y="277" className="schematic-site-label">CANDIDATE SITE</text>
        <text x="420" y="294" className="schematic-small-label">SOUTH-POLAR REGION</text>
        <text x="360" y="417" textAnchor="middle" className="schematic-moon-label">LUNAR SURFACE</text>
      </svg>
      <div className="mission-factor-row">
        <div><span>01 / LOCATION</span><b>Site coordinates</b></div>
        <div><span>02 / TIME</span><b>Observation window</b></div>
        <div><span>03 / ENVIRONMENT</span><b>Terrain · Sun · Earth</b></div>
      </div>
      <div className="mission-visual-foot">
        <span>EXPLORE THE VARIABLES BEHIND A MISSION</span>
        <span>ILLUSTRATIVE CONTEXT · NOT A LANDING VERDICT</span>
      </div>
    </div>
  );
}

export default function ProjectOverview() {
  return (
    <section className="overview-section" id="project-overview" aria-labelledby="overview-title">
      <div className="overview-shell">
        <div className="overview-copy" data-reveal="left">
          <p className="section-eyebrow"><span aria-hidden="true" />WHAT IS LUNEX?</p>
          <h2 id="overview-title">A clearer view of<br /><em>lunar mission planning.</em></h2>
          <p className="overview-lede">
            Lunex is an interactive mission-planning platform focused on the Moon’s south pole. It brings a 3D view of the lunar surface together with location data and observation-time controls, helping researchers and space explorers examine how place, terrain, sunlight and Earth visibility shape a mission scenario.
          </p>
          <p className="overview-supporting">
            Explore a region, set a time, and compare different scenarios. Lunex helps teams organize the questions behind a landing plan; mission decisions still depend on validated scientific and engineering analysis.
          </p>
          <div className="overview-steps">
            {steps.map((step, index) => (
              <article className="overview-step" key={step.number} data-reveal="up" style={{ "--reveal-delay": `${index * 90}ms` } as CSSProperties}>
                <span className="overview-step-number">{step.number}</span>
                <div><h3>{step.title}</h3><p>{step.description}</p></div>
              </article>
            ))}
          </div>
          <Link className="overview-link" href="/explorer"><span>Open Mission Explorer</span><span aria-hidden="true">↗</span></Link>
        </div>
        <div data-reveal="scale"><MissionSchematic /></div>
      </div>
    </section>
  );
}