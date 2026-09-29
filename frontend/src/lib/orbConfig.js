export const DEFAULT_ORB = {
  color: "#8fb4ff",
  size: 0.16,
  floatSpeed: 0.5,
  lightning: 0.5,
  chaos: 1,
  idle: 0.12,
  density: 1,
};

export function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 143, g: 180, b: 255 };
}

export const ORB_PRESETS = [
  { label: "Plasma Blue", color: "#8fb4ff" },
  { label: "Ember", color: "#ff7a33" },
  { label: "Toxic Green", color: "#6dffb0" },
  { label: "Violet", color: "#b98cff" },
  { label: "Crimson", color: "#ff5a6e" },
  { label: "Ghost White", color: "#e8eeff" },
];

export const ORB_MOODS = [
  { label: "Calm",    config: { color: "#8fb4ff", size: 0.17, floatSpeed: 0.3, lightning: 0.2, chaos: 0.5, idle: 0.06 } },
  { label: "Focus",   config: { color: "#e8eeff", size: 0.15, floatSpeed: 0.4, lightning: 0.4, chaos: 0.8, idle: 0.1 } },
  { label: "Storm",   config: { color: "#9fc0ff", size: 0.16, floatSpeed: 0.7, lightning: 1.1, chaos: 1.6, idle: 0.22 } },
  { label: "Inferno", config: { color: "#ff7a33", size: 0.18, floatSpeed: 0.6, lightning: 1.3, chaos: 1.9, idle: 0.28 } },
  { label: "Cosmic",  config: { color: "#b98cff", size: 0.17, floatSpeed: 0.5, lightning: 0.7, chaos: 1.2, idle: 0.14 } },
  { label: "Venom",   config: { color: "#6dffb0", size: 0.16, floatSpeed: 0.55, lightning: 0.9, chaos: 1.4, idle: 0.18 } },
];

