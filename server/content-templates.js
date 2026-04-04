/** Hook matrix for A/B testing (static templates — swap for LLM later). */
export const HOOKS_BY_PERSONA = {
  honeymoon: [
    "Your honeymoon should feel once-in-a-lifetime, not last-minute.",
    "Still deciding where to go after the wedding?",
    "Bali, Maldives, Dubai — which fits your vibe?",
  ],
  family: [
    "Family holiday without planning stress.",
    "Kid-friendly travel deals for your next school break.",
    "School break coming — lock dates before prices jump.",
  ],
  luxury: [
    "Private, premium, seamless travel experiences.",
    "Luxury escapes curated for high-comfort travelers.",
    "Five-star stays, zero guesswork.",
  ],
  default: [
    "Book smarter travel with local experts.",
    "Limited slots for peak season — check availability today.",
  ],
};

export const OFFERS = [
  "Limited-time hotel + flight bundle",
  "Free airport transfer",
  "Flexible date reschedule",
  "Early-booking discount",
];

export function buildHookMatrix() {
  const rows = [];
  for (const [persona, hooks] of Object.entries(HOOKS_BY_PERSONA)) {
    for (let i = 0; i < hooks.length; i += 1) {
      rows.push({ persona, hookId: `${persona}_${i + 1}`, text: hooks[i] });
    }
  }
  return rows;
}

export function generateVideoScript({ persona = "honeymoon", destination = "Bali", offer = OFFERS[0] }) {
  const hooks = HOOKS_BY_PERSONA[persona] || HOOKS_BY_PERSONA.default;
  const hook = hooks[0];
  return {
    persona,
    destination,
    offer,
    scenes: [
      { t: "0-3s", line: `Hook: ${hook}` },
      { t: "3-8s", line: `Problem: planning overload + price fear for ${destination}.` },
      { t: "8-14s", line: `Offer: ${offer} — dates + quote in minutes.` },
      { t: "14-20s", line: "Proof: ratings + real traveler stories (insert clips)." },
      { t: "20-25s", line: "CTA: Get custom quote / WhatsApp expert." },
    ],
    caption: `${destination} package — ${offer}. Reply “GO” for a quote.`,
  };
}
