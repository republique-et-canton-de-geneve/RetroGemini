// Small deterministic PRNG so a load-test run is reproducible with --seed.

// FNV-1a string hash to derive per-client seeds from a run seed + label.
const hashString = (str) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

// mulberry32: fast, decent-quality 32-bit PRNG.
const createRng = (seed) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const rngFor = (runSeed, label) => createRng(hashString(`${runSeed}:${label}`));

const randInt = (rng, min, max) => min + Math.floor(rng() * (max - min + 1));

const pick = (rng, items) => items[Math.floor(rng() * items.length)];

export { hashString, createRng, rngFor, randInt, pick };
