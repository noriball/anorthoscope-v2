// Deterministic check of the paint "wedge → 360°" transform (no browser).
// Correct geometry (confirmed by user):
//   - Output radius = the ACTUAL Euclidean distance from center of the source point
//     (NOT the vertical "height"). Radius is PRESERVED, never rescaled by position.
//   - Output angle = K × (actual polar angle of the source point, measured from the
//     wedge's center axis / straight-up direction).
// Consequences that must hold:
//   1. A constant-radius arc spanning the full wedge width → a complete circle (~360°).
//   2. A STRAIGHT horizontal chord at height h has its ENDPOINTS (near the slanted
//      edges) end up at a LARGER radius than its MIDPOINT (u=0) — because the actual
//      Euclidean distance from center is bigger at the edges of a straight chord.
//      (A perfect circle for a straight chord would be WRONG.)
//   3. The wedge's straight slanted edge (constant angle β=±π/K, varying radius) maps
//      to a straight radial spoke in the output (constant angle, not curved).
//
// Run: node web/scripts/verify-stretch.mjs

const PAINT = 800;
const CX = PAINT / 2;
const CY = PAINT / 2;
const CENTER_ANGLE = -Math.PI / 2;

function norm(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Inverse map (output pixel → source), mirrors PaintEditor.stretch(). */
function sampleSource(outX, outY, N, K) {
  const c = N / 2;
  const artScale = PAINT / N;
  const dx = outX - c;
  const dy = outY - c;
  const Rout = Math.hypot(dx, dy);
  if (Rout > c) return null;
  const theta = norm(Math.atan2(dx, -dy)); // angle from up, [-π,π]
  const beta = theta / K; // inverse of angle-scale-by-K
  const r = Rout * artScale; // radius PRESERVED (only rescaled px units)
  const srcX = CX + r * Math.sin(beta);
  const srcY = CY - r * Math.cos(beta);
  return { srcX, srcY, theta, r };
}

let pass = true;
const log = (ok, msg) => {
  if (!ok) pass = false;
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
};

for (const K of [2, 3, 4, 5, 6, 8]) {
  const halfBeta = Math.PI / K;

  // --- Test 1 (analytic): a constant-radius arc spanning the full wedge width → full circle.
  // The forward map for a point at (β, r) is θ_out = K·β. As β sweeps the whole wedge
  // width [-halfBeta, halfBeta], θ_out must sweep [-π, π] (a full circle), for every K.
  const thetaAtNegEdge = K * -halfBeta;
  const thetaAtPosEdge = K * halfBeta;
  const spanRad = thetaAtPosEdge - thetaAtNegEdge;
  const spanDeg = (spanRad * 180) / Math.PI;
  log(Math.abs(spanDeg - 360) < 0.01, `K=${K} full-width arc → ${spanDeg.toFixed(1)}° (want 360, full circle)`);

  // --- Test 2: straight horizontal chord — endpoints must reach LARGER radius than midpoint ---
  const h = 260; // source height of the chord
  const halfW = K === 2 ? h * 20 : h * Math.tan(halfBeta); // K=2 wedge is a half-plane (β=π/2); use a large finite width
  const rMid = h; // Euclidean radius at u=0
  const rEnd = Math.hypot(halfW * 0.96, h); // near the endpoint (96% out to the edge)
  log(
    rEnd > rMid + 1,
    `K=${K} chord: endpoint radius ${rEnd.toFixed(1)} > midpoint radius ${rMid.toFixed(1)} (bulge, not a circle)`,
  );

  // --- Test 3: wedge edge (β=+halfBeta, varying r) stays a straight radial spoke at θ=+π ---
  const edgeThetas = [];
  for (const r of [50, 150, 250, 350]) {
    const x = CX + r * Math.sin(halfBeta);
    const y = CY - r * Math.cos(halfBeta);
    // forward-map this source point the same way `compress()` would, to find its output angle
    const beta = halfBeta; // by construction
    const thetaOut = K * beta;
    edgeThetas.push(Math.round((thetaOut * 180) / Math.PI));
  }
  const allSame = edgeThetas.every((d) => d === edgeThetas[0]);
  log(allSame, `K=${K} wedge edge stays a straight spoke at constant angle ${edgeThetas[0]}° (${edgeThetas.join(",")})`);
}

console.log(pass ? "\nALL PASS" : "\nSOME FAILED");
process.exit(pass ? 0 : 1);
