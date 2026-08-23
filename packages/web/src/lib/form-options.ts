export const INDUSTRY_OPTIONS = [
  "AI & machine learning",
  "B2B SaaS",
  "Climate tech",
  "Consumer",
  "Cybersecurity",
  "Developer tools",
  "E-commerce",
  "Edtech",
  "Fintech",
  "Healthtech",
  "Infrastructure",
  "Logistics",
  "Marketplaces",
  "Real estate",
  "Robotics",
] as const;

export const ROUND_NAME_OPTIONS = [
  "Pre-Seed",
  "Seed",
  "Seed Extension",
  "Bridge",
  "Series A",
  "Series B",
  "Series C",
  "Growth",
  "Strategic",
] as const;

export const CURRENCY_OPTIONS = [
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "CHF",
  "JPY",
  "SGD",
  "AED",
  "SEK",
  "NOK",
  "DKK",
  "INR",
] as const;

export const REVIEWER_EXPIRY_OPTIONS = [
  { value: "7", label: "7 days" },
  { value: "14", label: "14 days" },
  { value: "30", label: "30 days" },
  { value: "60", label: "60 days" },
  { value: "90", label: "90 days" },
] as const;

export function selectOptions(values: readonly string[]) {
  return values.map((value) => ({ value, label: value }));
}

/** Keep an existing legacy/custom value visible while editing old records. */
export function selectOptionsWithCurrent(values: readonly string[], current: string) {
  return selectOptions(!current || values.some((value) => value === current) ? values : [current, ...values]);
}
