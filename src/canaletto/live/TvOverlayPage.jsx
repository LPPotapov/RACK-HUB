// TV match lower-third OBS overlay (LIVE milestone) — broadcast-facing,
// read-only, no director controls. Intended as an OBS Browser Source
// cropped to the bottom strip of the stream frame (see LivePage.jsx for the
// exact link). Player names/GBR/win% are read live from the SAME
// authoritative match record the director app uses (frozen at pairing
// time for Blocks, calibration-time for KO, never invented here) via
// resolveTvMatch()'s NORMALIZED shape, identical whether the selected match
// is a Block A/B Swiss match or a KO match (director correction pass —
// "the ticker must work during Block A, Block B, Top16, QF, SF, Final").
// The SCORE shown is deliberately NOT the official result but
// getCurrentTvScore(liveState) — the independent, PER-MATCH broadcast score
// settable from either the director's LIVE page or the streaming staff's TV
// Overlay Score Control page. Score-only separation, not a second copy of
// the match.
//
// LIVE/OBS correction pass — meta row redesign: the brand mark no longer
// sits to one side of the whole ticker (that read as asymmetric); it is now
// CENTERED, directly above the score, flanked by the match's source label
// (left) and table (right) on the same row — a balanced 1fr/auto/1fr row,
// mirroring the same balanced-left/right idea as the player row below it.
//
// LIVE/OBS final polish pass — ~20% shorter: tighter panel padding, row
// gaps, and line-height only (py-3->py-2, mb-1.5->mb-1, leading-none/tight
// added) — no content removed, no font sizes cut.
//
// A LATER width-narrowing pass (max-w-4xl -> max-w-2xl) was reverted per
// director feedback: normal Canaletto player names no longer fit reliably
// at that width. The panel is back to its original ~wide max-w-4xl/px-5,
// keeping every other polish-pass change (height, meta-row layout, corner
// radius) intact.
//
// LIVE/OBS alignment fix — the meta row (source label / table) and the
// player row used to be TWO SEPARATE grids. Even with matching
// `grid-cols-[1fr_auto_1fr]` templates, each grid sized its own "auto"
// center column independently (the logo's fixed 40px vs. the score text's
// natural width), so the side columns ended up different widths between
// the two rows — the meta text was anchored to the OUTER panel edges
// instead of to the player columns above/below it. Fixed by making this
// ONE grid (3 columns × 2 rows, six direct children in DOM order) so both
// rows share the exact same column tracks, and by right-/left-aligning the
// meta text the SAME direction as the player name/GBR line below it (was
// text-left/text-right — backwards relative to the mirrored player block).
//
// LIVE/OBS polish pass — one further SMALL vertical trim: py-2->py-1.5,
// gap-y-1->gap-y-0.5, and the GBR/win% line tightened to leading-none.
// Deliberately minor — panel width, font sizes, score size, logo size/
// position and every other proportion are unchanged.
//
// LIVE/OBS internal-gap fix — TOTAL panel height must stay EXACTLY as it
// was (director explicitly ruled out any further height reduction); only
// the internal gap between the meta row and the player row should shrink.
// So the gap-y-0.5 (2px) between rows was removed (gap-y-0) and that exact
// 2px was moved back into the panel's own top/bottom padding
// (py-1.5 -> py-[7px], +1px each side) — a redistribution, not a
// reduction: 6+6+2=14px before, 7+7+0=14px now. The player row now sits
// right up against the meta row; the panel's outer edges haven't moved.

import { getCurrentTvScore, resolveTvMatch } from '../../application/canalettoLive.js';
import { LiveBrandMark } from './liveComponents.jsx';
import { useCanalettoEventReadOnly } from './useCanalettoEventReadOnly.js';
import { useCanalettoLiveState } from '../useCanalettoLiveState.js';

// No overlay panel shown at all when nothing is selected — an OBS Browser
// Source cropped to this page should simply show nothing (transparent),
// not a placeholder banner, once a real broadcast is live.
const EmptyOverlay = () => <div className="min-h-screen bg-transparent" />;

export const TvOverlayPage = () => {
  const event = useCanalettoEventReadOnly();
  const { liveState } = useCanalettoLiveState();
  const resolved = resolveTvMatch(event, liveState);

  if (!resolved) return <EmptyOverlay />;

  const { sourceLabel, tbl, p1, p2 } = resolved;
  const score = getCurrentTvScore(liveState);

  return (
    <div className="flex min-h-screen items-end justify-center bg-transparent p-4">
      <div className="w-full max-w-4xl rounded-lg border border-canaletto-gold/60 bg-canaletto-panel/95 px-5 py-[7px] shadow-2xl">
        {/* ONE grid for both rows (3 columns × 2 rows, six children in DOM
            order) — this is what makes the meta row's left/right anchors
            land on the EXACT same horizontal position as the player
            name/GBR line below it: a single set of shared column tracks,
            not two grids that happen to use the same template. Meta text
            is right-/left-aligned the SAME direction as the player block
            beneath it (LEFT column anchors toward center via text-right,
            RIGHT column anchors toward center via text-left) — the
            established mirrored layout, never the outer panel edges. Rows
            sit directly against each other (gap-y-0) — see the
            internal-gap-fix note above for why the panel's own padding grew
            by exactly the amount this gap shrank, keeping total height
            unchanged. */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-4 gap-y-0">
          <div className="truncate text-right font-condensed text-[10px] font-bold uppercase leading-none tracking-widest text-canaletto-lavender">
            {sourceLabel}
          </div>
          <LiveBrandMark className="h-10 w-10 shrink-0 justify-self-center" />
          <div className="truncate text-left font-condensed text-[10px] font-bold uppercase leading-none tracking-widest text-canaletto-lavender">
            {tbl ? `TABLE ${tbl}` : ''}
          </div>

          {/* Mirrored left/right around the center score — LEFT: name then
              "GBR · win%"; RIGHT: name then "win% · GBR" (same mirrored
              metadata direction as ui.jsx's PlayerBlock on match cards).
              Equal 1fr columns on both sides keep name width/weight
              comparable regardless of which name is longer. */}
          <div className="min-w-0 text-right">
            <div className="truncate font-condensed text-xl font-black uppercase leading-tight text-canaletto-cream">{p1.name}</div>
            <div className="leading-none text-xs text-canaletto-lavender">GBR {Math.round(p1.gbr)} · {Math.round(p1.winPct)}%</div>
          </div>
          <div className="justify-self-center text-center font-condensed text-3xl font-black leading-none tabular-nums text-canaletto-gold">
            {score.r1} : {score.r2}
          </div>
          <div className="min-w-0 text-left">
            <div className="truncate font-condensed text-xl font-black uppercase leading-tight text-canaletto-cream">{p2.name}</div>
            <div className="leading-none text-xs text-canaletto-lavender">{Math.round(p2.winPct)}% · GBR {Math.round(p2.gbr)}</div>
          </div>
        </div>
      </div>
    </div>
  );
};
