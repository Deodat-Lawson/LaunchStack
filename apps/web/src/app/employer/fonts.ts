import { Inter, JetBrains_Mono, Instrument_Serif } from "next/font/google";

export const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-inter",
});

export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

export const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  display: "swap",
  variable: "--font-instrument-serif",
});
