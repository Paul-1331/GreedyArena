/**
 * Glicko-2 Rating System Implementation
 * Based on Mark Glickman's paper: http://www.glicko.net/glicko/glicko2.pdf
 *
 * Default values: rating=1500, deviation=350, volatility=0.06
 */

const TAU = 0.5;
const EPSILON = 0.000001;
const GLICKO2_SCALE = 173.7178;

const toGlicko2 = (rating) => (rating - 1500) / GLICKO2_SCALE;
const toGlicko2RD = (rd) => rd / GLICKO2_SCALE;
const fromGlicko2 = (mu) => mu * GLICKO2_SCALE + 1500;
const fromGlicko2RD = (phi) => phi * GLICKO2_SCALE;

const g = (phi) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));

const E = (mu, muj, phij) => 1 / (1 + Math.exp(-g(phij) * (mu - muj)));

/**
 * Calculate updated Glicko-2 ratings for a player after a set of matches.
 * @param {{rating: number, deviation: number, volatility: number}} player
 * @param {{rating: number, deviation: number, score: number}[]} opponents
 */
export function updateRating(player, opponents) {
  if (opponents.length === 0) {
    const phi = toGlicko2RD(player.deviation);
    const newPhi = Math.sqrt(phi * phi + player.volatility * player.volatility);
    return {
      rating: player.rating,
      deviation: Math.min(fromGlicko2RD(newPhi), 350),
      volatility: player.volatility,
    };
  }

  const mu = toGlicko2(player.rating);
  const phi = toGlicko2RD(player.deviation);
  const sigma = player.volatility;

  let vInv = 0;
  for (const opp of opponents) {
    const muj = toGlicko2(opp.rating);
    const phij = toGlicko2RD(opp.deviation);
    const gPhij = g(phij);
    const eVal = E(mu, muj, phij);
    vInv += gPhij * gPhij * eVal * (1 - eVal);
  }
  const v = 1 / vInv;

  let deltaSum = 0;
  for (const opp of opponents) {
    const muj = toGlicko2(opp.rating);
    const phij = toGlicko2RD(opp.deviation);
    deltaSum += g(phij) * (opp.score - E(mu, muj, phij));
  }
  const delta = v * deltaSum;

  const a = Math.log(sigma * sigma);
  const phiSq = phi * phi;
  const deltaSq = delta * delta;

  const f = (x) => {
    const ex = Math.exp(x);
    const d = phiSq + v + ex;
    return (ex * (deltaSq - phiSq - v - ex)) / (2 * d * d) - (x - a) / (TAU * TAU);
  };

  let A = a;
  let B;
  if (deltaSq > phiSq + v) {
    B = Math.log(deltaSq - phiSq - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }

  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > EPSILON) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }

  const newSigma = Math.exp(A / 2);
  const phiStar = Math.sqrt(phiSq + newSigma * newSigma);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * deltaSum;

  return {
    rating: Math.round(fromGlicko2(newMu)),
    deviation: Math.round(fromGlicko2RD(newPhi) * 100) / 100,
    volatility: Math.round(newSigma * 1000000) / 1000000,
  };
}

/**
 * Given a list of participants with score and current rating from an official match,
 * compute pairwise outcomes and return updated ratings.
 * @param {{user_id: string, score: number, rating: {rating:number, deviation:number, volatility:number}}[]} participants
 * @returns {Map<string, {rating:number, deviation:number, volatility:number}>}
 */
export function computeMatchRatings(participants) {
  const results = new Map();

  for (const player of participants) {
    const opponents = participants
      .filter((p) => p.user_id !== player.user_id)
      .map((opp) => {
        let s;
        if (player.score > opp.score) s = 1;
        else if (player.score < opp.score) s = 0;
        else s = 0.5;

        return { rating: opp.rating.rating, deviation: opp.rating.deviation, score: s };
      });

    results.set(player.user_id, updateRating(player.rating, opponents));
  }

  return results;
}