/** Map paint colours (MapLibre can't read CSS variables). Keep in sync with styles/global.css. */
export const MAP_STYLE = {
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
} as const;

/** Chart colours: one accent, the rest grays (Recharts props take literal colours). */
export const CHART = {
  light: { accent: "#276EF1", gray: "#8F8F8F", lightGray: "#D6D6D6", ink: "#000000", ink2: "#6B6B6B", grid: "#EDEDED", surface: "#FFFFFF" },
  dark: { accent: "#5B91F5", gray: "#7A7A7A", lightGray: "#3A3A3A", ink: "#FFFFFF", ink2: "#A6A6A6", grid: "#262626", surface: "#141414" },
} as const;

export type ChartPalette = (typeof CHART)["light" | "dark"];

export interface MapPalette {
  surplus: string;
  deficit: string;
  balanced: string;
  stroke: string;
  route: string;
  walk: string;
  compare: string;
  selected: string;
}

export const PALETTE: Record<"light" | "dark", MapPalette> = {
  light: {
    surplus: "#276EF1",
    deficit: "#E11900",
    balanced: "#AFAFAF",
    stroke: "#FFFFFF",
    route: "#000000",
    walk: "#6B6B6B",
    compare: "#9A9A9A",
    selected: "#000000",
  },
  dark: {
    surplus: "#5B91F5",
    deficit: "#F0543C",
    balanced: "#7A7A7A",
    stroke: "#141414",
    route: "#FFFFFF",
    walk: "#A6A6A6",
    compare: "#6B6B6B",
    selected: "#FFFFFF",
  },
};
