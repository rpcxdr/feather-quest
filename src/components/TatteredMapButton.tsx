import React, { useState } from 'react';

interface TatteredMapButtonProps {
  onClick: (e: React.MouseEvent) => void;
}

/**
 * TatteredMapButton
 *
 * Renders an antique cartographic fragment resembling the bottom of a weathered,
 * tattered map with burnt edges, hand-drawn topographic contour lines, mountain glyphs,
 * an expedition flight path initiating from the center bottom and extending upward,
 * and a top vertical fade suggesting the map extends infinitely upward.
 */
export const TatteredMapButton: React.FC<TatteredMapButtonProps> = ({ onClick }) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <button
      id="btn-map-bottom"
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="pointer-events-auto cursor-pointer relative group flex items-center justify-center w-60 h-20 sm:w-72 sm:h-24 md:w-84 md:h-28 lg:w-96 lg:h-32 select-none transition-all duration-300 transform hover:scale-105 active:scale-95 focus:outline-none"
      aria-label="Open Flight Map"
      title="Open Flight Path Map"
    >
      {/* Ambient warm ember / golden backlight behind the tattered edges */}
      <div
        className={`absolute -inset-2 rounded-2xl bg-gradient-to-t from-amber-600/35 via-yellow-600/20 to-transparent blur-xl pointer-events-none transition-opacity duration-300 ${
          isHovered ? 'opacity-100 scale-105' : 'opacity-60'
        }`}
      />

      {/* SVG Canvas rendering the tattered map fragment */}
      <svg
        className="w-full h-full drop-shadow-[0_12px_22px_rgba(0,0,0,0.85)] filter overflow-visible"
        viewBox="0 0 340 120"
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Top Transparency Fade Mask: Fades from 0% opacity at top edge to 100% opacity further down */}
          <linearGradient id="map-top-fade-grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.0" />
            <stop offset="18%" stopColor="#ffffff" stopOpacity="0.25" />
            <stop offset="38%" stopColor="#ffffff" stopOpacity="0.75" />
            <stop offset="60%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="1.0" />
          </linearGradient>

          <mask id="map-vertical-fade-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="340" height="120">
            <rect x="0" y="0" width="340" height="120" fill="url(#map-top-fade-grad)" />
          </mask>

          {/* Aged Parchment Vellum Color Gradient */}
          <linearGradient id="parchment-base" x1="20%" y1="100%" x2="80%" y2="0%">
            <stop offset="0%" stopColor="#c89d66" />
            <stop offset="30%" stopColor="#dcb882" />
            <stop offset="65%" stopColor="#ebd4a4" />
            <stop offset="100%" stopColor="#edd8b0" />
          </linearGradient>

          {/* Charred / Scorched Edge Gradient for Left, Bottom & Right rims */}
          <radialGradient id="charred-glow" cx="50%" cy="100%" r="75%">
            <stop offset="50%" stopColor="#2e1406" stopOpacity="0" />
            <stop offset="85%" stopColor="#572205" stopOpacity="0.55" />
            <stop offset="97%" stopColor="#200b02" stopOpacity="0.92" />
            <stop offset="100%" stopColor="#100501" stopOpacity="0.98" />
          </radialGradient>

          {/* Golden flight trail glow filter */}
          <filter id="path-ember-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Group with Vertical Fade Mask applied so top fades to 0% transparency */}
        <g mask="url(#map-vertical-fade-mask)">
          {/* Base Parchment Shape with Tattered Left, Bottom, and Right Edges */}
          {/*
            Coordinates:
            Top: from (4, 0) to (336, 0) - flat so it dissolves cleanly upward
            Right Edge: (336, 0) down to (328, 114) with jagged rips & burned notches
            Bottom Edge: (328, 114) across to (14, 115) with charred wave tears
            Left Edge: (14, 115) up to (4, 0) with singed bites
          */}
          <path
            d="
              M 4 0
              L 336 0
              L 334 16
              Q 329 25, 333 36
              L 328 47
              Q 332 58, 327 70
              L 331 82
              Q 326 94, 330 104
              L 324 113
              Q 308 110, 292 116
              L 276 112
              Q 260 117, 244 111
              L 226 115
              Q 210 111, 194 116
              L 178 112
              Q 166 118, 154 114
              L 140 117
              Q 122 111, 106 116
              L 88 112
              Q 70 117, 54 112
              L 36 116
              Q 22 111, 14 115
              L 12 102
              Q 17 88, 11 76
              L 15 62
              Q 10 48, 14 34
              L 8 18
              Q 13 8, 4 0
              Z
            "
            fill="url(#parchment-base)"
          />

          {/* Scorched & Charred Edge Shadowing inside the tattered perimeter */}
          <path
            d="
              M 4 0
              L 336 0
              L 334 16
              Q 329 25, 333 36
              L 328 47
              Q 332 58, 327 70
              L 331 82
              Q 326 94, 330 104
              L 324 113
              Q 308 110, 292 116
              L 276 112
              Q 260 117, 244 111
              L 226 115
              Q 210 111, 194 116
              L 178 112
              Q 166 118, 154 114
              L 140 117
              Q 122 111, 106 116
              L 88 112
              Q 70 117, 54 112
              L 36 116
              Q 22 111, 14 115
              L 12 102
              Q 17 88, 11 76
              L 15 62
              Q 10 48, 14 34
              L 8 18
              Q 13 8, 4 0
              Z
            "
            fill="url(#charred-glow)"
          />

          {/* Singed / Burnt Outer Crust Stroke on the bottom, left, and right */}
          <path
            d="
              M 336 0
              L 334 16
              Q 329 25, 333 36
              L 328 47
              Q 332 58, 327 70
              L 331 82
              Q 326 94, 330 104
              L 324 113
              Q 308 110, 292 116
              L 276 112
              Q 260 117, 244 111
              L 226 115
              Q 210 111, 194 116
              L 178 112
              Q 166 118, 154 114
              L 140 117
              Q 122 111, 106 116
              L 88 112
              Q 70 117, 54 112
              L 36 116
              Q 22 111, 14 115
              L 12 102
              Q 17 88, 11 76
              L 15 62
              Q 10 48, 14 34
              L 8 18
              Q 13 8, 4 0
            "
            fill="none"
            stroke="#1c0a02"
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.95"
          />

          {/* Secondary inner ember scorch line */}
          <path
            d="
              M 333 4
              L 331 18
              Q 326 27, 330 38
              L 325 48
              Q 329 59, 324 71
              L 328 83
              Q 323 94, 327 103
              L 321 110
              Q 307 107, 291 113
              L 275 109
              Q 259 114, 243 108
              L 225 112
              Q 209 108, 193 113
              L 177 109
              Q 165 115, 153 111
              L 139 114
              Q 121 108, 105 113
              L 87 109
              Q 69 114, 53 109
              L 35 113
              Q 21 108, 16 111
              L 15 100
              Q 19 87, 14 75
              L 18 61
              Q 13 47, 17 33
              L 11 17
              Q 15 8, 7 4
            "
            fill="none"
            stroke="#853507"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.65"
          />

          {/* ---------------------------------------------------- */}
          {/* TERRAIN MARKINGS: Contours, Mountains, Woodlands & Grid */}
          {/* ---------------------------------------------------- */}
          <g opacity="0.45" stroke="#5a3511" strokeWidth="0.9" fill="none">
            {/* Topographic Contour Elevation Curves */}
            <path d="M 18 96 Q 70 82, 130 92 T 230 86 T 322 98" />
            <path d="M 22 80 Q 80 66, 145 78 T 240 70 T 320 84" />
            <path d="M 28 64 Q 75 50, 135 60 T 215 54 T 315 68" strokeDasharray="3 2" opacity="0.6" />
            <path d="M 32 46 Q 90 32, 160 42 T 255 36 T 312 50" opacity="0.4" />
            <path d="M 36 28 Q 110 16, 185 24 T 280 20 T 310 32" opacity="0.3" />

            {/* Left Terrain Mountain Peaks */}
            <path d="M 38 88 L 48 68 L 58 88" strokeWidth="1.3" />
            <path d="M 48 68 L 48 88" strokeWidth="0.8" opacity="0.7" />
            <path d="M 54 90 L 66 64 L 78 90" strokeWidth="1.4" />
            <path d="M 66 64 L 66 90" strokeWidth="0.8" opacity="0.7" />
            <path d="M 74 91 L 84 73 L 94 91" strokeWidth="1.2" />

            {/* Right Terrain Mountain Peaks */}
            <path d="M 248 90 L 260 66 L 272 90" strokeWidth="1.4" />
            <path d="M 260 66 L 260 90" strokeWidth="0.8" opacity="0.7" />
            <path d="M 268 92 L 280 70 L 292 92" strokeWidth="1.3" />
            <path d="M 288 94 L 298 76 L 308 94" strokeWidth="1.1" />

            {/* Woodland / Tree symbols */}
            <path d="M 98 94 Q 98 88, 102 88 Q 106 88, 106 94 Z M 102 94 L 102 98" fill="#5a3511" fillOpacity="0.25" />
            <path d="M 108 96 Q 108 90, 112 90 Q 116 90, 116 96 Z M 112 96 L 112 100" fill="#5a3511" fillOpacity="0.25" />
            <path d="M 226 94 Q 226 88, 230 88 Q 234 88, 234 94 Z M 230 94 L 230 98" fill="#5a3511" fillOpacity="0.25" />
            <path d="M 236 96 Q 236 90, 240 90 Q 244 90, 244 96 Z M 240 96 L 240 100" fill="#5a3511" fillOpacity="0.25" />

            {/* Subtle ancient coordinate crosshairs / ticks */}
            <path d="M 170 12 L 170 24 M 164 18 L 176 18" strokeWidth="0.8" opacity="0.5" />
            <path d="M 85 36 L 97 36 M 91 30 L 91 42" strokeWidth="0.7" opacity="0.35" />
            <path d="M 248 36 L 260 36 M 254 30 L 254 42" strokeWidth="0.7" opacity="0.35" />
          </g>

          {/* ---------------------------------------------------- */}
          {/* FLIGHT PATH INITIATION: Center bottom extending upward */}
          {/* ---------------------------------------------------- */}
          {/* Center Origin Node Marker at bottom */}
          <g transform="translate(170, 112)">
            {/* Pulsing origin halo ring */}
            <circle
              cx="0"
              cy="0"
              r={isHovered ? 6 : 5}
              fill="none"
              stroke="#f59e0b"
              strokeWidth="1.5"
              className="transition-all duration-300"
            />
            {/* Origin center point */}
            <circle cx="0" cy="0" r="2.5" fill="#d97706" />
            {/* Tiny compass tick marks */}
            <line x1="0" y1="-7" x2="0" y2="-5" stroke="#78350f" strokeWidth="1.2" />
            <line x1="-7" y1="0" x2="-5" y2="0" stroke="#78350f" strokeWidth="1.2" />
            <line x1="7" y1="0" x2="5" y2="0" stroke="#78350f" strokeWidth="1.2" />
          </g>

          {/* Dashed Flight Trajectory curving up toward the middle and fading beyond */}
          {/* Glowing underlay */}
          <path
            d="
              M 170 108
              C 170 94, 156 86, 158 66
              C 160 52, 172 40, 168 14
              L 168 0
            "
            fill="none"
            stroke="#f59e0b"
            strokeWidth="5"
            strokeLinecap="round"
            strokeOpacity={isHovered ? '0.45' : '0.25'}
            filter="url(#path-ember-glow)"
          />

          {/* Sharp Expedition Track Line */}
          <path
            d="
              M 170 108
              C 170 94, 156 86, 158 66
              C 160 52, 172 40, 168 14
              L 168 0
            "
            fill="none"
            stroke="#9a3412"
            strokeWidth="2.8"
            strokeDasharray="5 3.5"
            strokeLinecap="round"
          />

          <path
            d="
              M 170 108
              C 170 94, 156 86, 158 66
              C 160 52, 172 40, 168 14
              L 168 0
            "
            fill="none"
            stroke="#fbbf24"
            strokeWidth="1.6"
            strokeDasharray="5 3.5"
            strokeLinecap="round"
          />

          {/* Tiny upward expedition arrowhead near top */}
          <path
            d="M 164 12 L 168 4 L 172 12"
            fill="none"
            stroke="#fbbf24"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* ---------------------------------------------------- */}
          {/* CENTER DISPLAY TYPOGRAPHY: "Map"                     */}
          {/* ---------------------------------------------------- */}
          {/* Soft ink-stained backing banner behind text to guarantee contrast against terrain */}
          <ellipse
            cx="170"
            cy="54"
            rx="56"
            ry="19"
            fill="#d6b17c"
            fillOpacity="0.5"
            filter="blur(4px)"
          />

          {/* Engraved Deep Shadow */}
          <text
            x="170"
            y="66"
            textAnchor="middle"
            className="font-serif font-black tracking-[0.25em] select-none"
            style={{
              fontSize: '36px',
              fill: '#1a0d04',
              fontFamily: "'Cinzel Decorative', 'Metamorphous', Georgia, serif",
              fontWeight: 900,
            }}
          >
            Map
          </text>

          {/* Top-rim Embossed Highlight */}
          <text
            x="170"
            y="64.5"
            textAnchor="middle"
            className="font-serif font-black tracking-[0.25em] select-none"
            style={{
              fontSize: '36px',
              fill: isHovered ? '#fff3d6' : '#fdf6e7',
              fontFamily: "'Cinzel Decorative', 'Metamorphous', Georgia, serif",
              fontWeight: 900,
            }}
          >
            Map
          </text>

          {/* Crisp Dark Walnut Face */}
          <text
            x="170"
            y="65.2"
            textAnchor="middle"
            className="font-serif font-black tracking-[0.25em] select-none transition-colors duration-200"
            style={{
              fontSize: '36px',
              fill: isHovered ? '#1c0a02' : '#2d1405',
              fontFamily: "'Cinzel Decorative', 'Metamorphous', Georgia, serif",
              fontWeight: 900,
            }}
          >
            Map
          </text>
        </g>
      </svg>
    </button>
  );
};
